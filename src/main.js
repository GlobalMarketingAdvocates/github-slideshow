import { Actor, log } from 'apify';
import { chromium } from 'playwright';

await Actor.init();

const input = await Actor.getInput() ?? {};
const {
  groupUrl,
  cookies = [],
  targetUsername = '',
  maxPostsToCheck = 8,
  scanMentionsOnly = false,
  scanComments = true,
  scanBlitzTab = false,
  webhookUrl,
  mode = 'scan',
  replyContent,
  postId,
  parentId,
} = input;

if (!groupUrl) throw new Error('groupUrl is required.');
if (!Array.isArray(cookies) || cookies.length === 0) throw new Error('cookies must be a non-empty array.');
if (!['scan', 'post'].includes(mode)) throw new Error('mode must be scan or post.');
if (mode === 'post' && (!replyContent || !postId)) throw new Error('post mode requires replyContent and postId.');

const kv = await Actor.openKeyValueStore();
const stateKey = `state:${groupUrl}`;
const state = (await kv.getValue(stateKey)) || { lastSeenPostIds: [], lastSeenCommentIds: [] };
const knownPostIds = new Set(state.lastSeenPostIds || []);
const knownCommentIds = new Set(state.lastSeenCommentIds || []);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies(cookies);
const page = await context.newPage();

const normalizeUsername = (name) => name?.toLowerCase().replace(/^@/, '');
const target = normalizeUsername(targetUsername);

const extractIdFromEl = async (locator, fallbackPrefix) => {
  const idFromAttr = await locator.getAttribute('data-id');
  if (idFromAttr) return idFromAttr;
  const href = await locator.locator('a[href*="/post/"]').first().getAttribute('href').catch(() => null);
  if (href) return href.split('/').filter(Boolean).pop();
  return `${fallbackPrefix}-${Math.random().toString(36).slice(2, 9)}`;
};

const parseMentions = (text) => {
  const mentions = [...text.matchAll(/@([a-zA-Z0-9_\-.]+)/g)].map((m) => m[1]);
  return [...new Set(mentions)];
};

const shouldKeep = (item) => {
  if (!scanMentionsOnly) return true;
  if (!target) return false;
  return item.mentions.map(normalizeUsername).includes(target);
};

const sendWebhook = async (payload) => {
  if (!webhookUrl) return;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook failed (${res.status}).`);
};

const gotoGroup = async () => {
  await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1500);
  if (scanBlitzTab) {
    const blitz = page.getByRole('tab', { name: /blitz/i }).first();
    if (await blitz.isVisible().catch(() => false)) {
      await blitz.click();
      await page.waitForTimeout(1200);
    }
  }
};

const postReply = async () => {
  await gotoGroup();
  const postLink = page.locator(`a[href*="/post/${postId}"]`).first();
  await postLink.scrollIntoViewIfNeeded();
  await postLink.click();
  await page.waitForLoadState('domcontentloaded');

  const inputBox = page.locator('textarea, [contenteditable="true"]').first();
  await inputBox.click();
  await inputBox.fill(replyContent);

  const submit = page.getByRole('button', { name: /post|reply|comment/i }).first();
  await submit.click();
  await page.waitForTimeout(1200);

  const result = {
    mode: 'post',
    ok: true,
    groupUrl,
    postId,
    parentId: parentId || null,
    replyContent,
    postedAt: new Date().toISOString(),
  };

  await Actor.pushData(result);
  await sendWebhook(result);
};

const scan = async () => {
  await gotoGroup();

  const posts = page.locator('article, [data-post-id], .post-item');
  const count = Math.min(await posts.count(), maxPostsToCheck);
  const events = [];

  for (let i = 0; i < count; i++) {
    const post = posts.nth(i);
    const postIdVal = (await post.getAttribute('data-post-id')) || await extractIdFromEl(post, 'post');
    if (knownPostIds.has(postIdVal)) continue;

    const postText = (await post.innerText()).trim();
    const postMentions = parseMentions(postText);
    const author = (await post.locator('[data-author], .author, a[href*="/u/"]').first().innerText().catch(() => ''))?.trim();
    const postUrl = await post.locator('a[href*="/post/"]').first().getAttribute('href').catch(() => null);
    const timestamp = await post.locator('time').first().getAttribute('datetime').catch(() => new Date().toISOString());

    const postEvent = {
      type: 'new_post',
      postId: postIdVal,
      commentId: null,
      author,
      text: postText,
      timestamp,
      url: postUrl ? new URL(postUrl, groupUrl).toString() : groupUrl,
      mentions: postMentions,
    };

    if (shouldKeep(postEvent)) events.push(postEvent);
    knownPostIds.add(postIdVal);

    if (!scanComments) continue;

    const comments = post.locator('[data-comment-id], .comment-item');
    const commentCount = Math.min(await comments.count(), 5);

    for (let j = 0; j < commentCount; j++) {
      const comment = comments.nth(j);
      const commentIdVal = (await comment.getAttribute('data-comment-id')) || await extractIdFromEl(comment, 'comment');
      if (knownCommentIds.has(commentIdVal)) continue;

      const commentText = (await comment.innerText()).trim();
      const commentMentions = parseMentions(commentText);
      const commentAuthor = (await comment.locator('[data-author], .author, a[href*="/u/"]').first().innerText().catch(() => ''))?.trim();
      const commentUrl = await comment.locator('a[href*="comment"], a[href*="/post/"]').first().getAttribute('href').catch(() => postUrl);
      const commentTimestamp = await comment.locator('time').first().getAttribute('datetime').catch(() => new Date().toISOString());

      const commentEvent = {
        type: 'new_comment',
        postId: postIdVal,
        commentId: commentIdVal,
        author: commentAuthor,
        text: commentText,
        timestamp: commentTimestamp,
        url: commentUrl ? new URL(commentUrl, groupUrl).toString() : groupUrl,
        mentions: commentMentions,
      };

      if (shouldKeep(commentEvent)) events.push(commentEvent);
      knownCommentIds.add(commentIdVal);
    }
  }

  const output = {
    mode: 'scan',
    groupUrl,
    scannedAt: new Date().toISOString(),
    totalNewEvents: events.length,
    events,
  };

  await kv.setValue(stateKey, {
    lastSeenPostIds: Array.from(knownPostIds).slice(-200),
    lastSeenCommentIds: Array.from(knownCommentIds).slice(-500),
    updatedAt: new Date().toISOString(),
  });

  await Actor.pushData(output);
  await sendWebhook(output);
};

try {
  if (mode === 'post') await postReply();
  else await scan();
} finally {
  await page.close();
  await context.close();
  await browser.close();
  await Actor.exit();
}
