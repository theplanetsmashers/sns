// bot.js
// 「伸びている投稿」を定期的に検出し、届いたコメントに自動で短文返信するボット(GitHub Actionsから定期実行)。
// フェーズ1(threads-post-generator)・フェーズ2(comment-generator)とは異なり、
// このツールは実際にThreads APIでコメント返信を自動投稿する(ユーザーの明示的な希望による設計)。
//
// 処理の流れ:
//  1. 自分の直近の投稿一覧を取得
//  2. 投稿ごとにインサイト(閲覧数など)を取得し、前回チェック時からの伸び幅で「伸びている投稿」を判定
//  3. 「伸びている」と判定された投稿(判定後 GROWTH_STICKY_HOURS の間)に届いた未返信コメントを取得
//  4. コメントごとにClaude APIで短い返信文を生成し、Threads APIで自動投稿
//  5. 実行結果をDiscordに通知(承認ステップなし。完全自動)

const { getMyProfile, listMyThreads, getInsights, listReplies, createReply } = require("./lib/threadsApi");
const { loadSnapshots, saveSnapshots, loadReplied, saveReplied } = require("./lib/state");
const { updatePostState } = require("./lib/growth");
const { generateReply } = require("./lib/generateReply");

const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const TONE = process.env.REPLY_TONE || "";

const config = {
  postLookbackHours: parseFloat(process.env.POST_LOOKBACK_HOURS || "72"),
  growthMinViewsDelta: parseInt(process.env.GROWTH_MIN_VIEWS_DELTA || "50", 10),
  growthMinRate: parseFloat(process.env.GROWTH_MIN_RATE || "0.2"),
  growthStickyHours: parseFloat(process.env.GROWTH_STICKY_HOURS || "24"),
  maxRepliesPerRun: parseInt(process.env.MAX_REPLIES_PER_RUN || "5", 10),
  maxRepliesPerPostPerRun: parseInt(process.env.MAX_REPLIES_PER_POST_PER_RUN || "3", 10),
};

function withinLookback(post, now) {
  const postedAt = new Date(post.timestamp).getTime();
  if (Number.isNaN(postedAt)) return false;
  return now.getTime() - postedAt <= config.postLookbackHours * 3600 * 1000;
}

async function postToDiscord(lines, growingCount) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("DISCORD_WEBHOOK_URL未設定のため、Discord通知はスキップします。");
    return;
  }
  if (lines.length === 0 && growingCount === 0) return; // 動きが何もなければ通知しない

  const header = growingCount > 0 ? `📈 伸びている投稿を${growingCount}件検出しました` : "📈 伸びている投稿の状況";
  const content = [header, "", ...lines].join("\n").slice(0, 1900);

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    console.error("Discord通知に失敗しました:", err.message);
  }
}

async function main() {
  if (!THREADS_ACCESS_TOKEN) {
    throw new Error("THREADS_ACCESS_TOKEN が設定されていません。");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  }

  const now = new Date();
  const profile = await getMyProfile(THREADS_ACCESS_TOKEN);
  const userId = process.env.THREADS_USER_ID || profile.id;

  const posts = await listMyThreads(userId, THREADS_ACCESS_TOKEN, { limit: 25 });
  const recentPosts = posts.filter((p) => withinLookback(p, now));

  const snapshots = loadSnapshots();
  const eligiblePosts = [];
  const newlyGrowing = [];

  for (const post of recentPosts) {
    let insights;
    try {
      insights = await getInsights(post.id, THREADS_ACCESS_TOKEN);
    } catch (err) {
      console.warn(`インサイト取得に失敗(投稿 ${post.id})、今回はスキップ: ${err.message}`);
      continue;
    }

    const prevEntry = snapshots[post.id] || {};
    const updated = updatePostState(prevEntry, post, insights, config, now);
    snapshots[post.id] = updated;

    if (updated.justDetectedGrowth) newlyGrowing.push({ ...post, insights });
    if (now.getTime() < (updated.growingUntil || 0)) eligiblePosts.push({ ...post, insights });
  }

  saveSnapshots(snapshots);

  const replied = loadReplied();
  const discordLines = [];
  let replyBudget = config.maxRepliesPerRun;

  // 伸び幅が大きい投稿から優先的にコメント返信を処理する
  eligiblePosts.sort((a, b) => (b.insights.views || 0) - (a.insights.views || 0));

  for (const post of eligiblePosts) {
    if (replyBudget <= 0) break;

    let replies;
    try {
      replies = await listReplies(post.id, THREADS_ACCESS_TOKEN);
    } catch (err) {
      console.warn(`コメント一覧取得に失敗(投稿 ${post.id}): ${err.message}`);
      continue;
    }

    const candidates = replies.filter(
      (r) =>
        r.username !== profile.username &&
        !replied.ids.has(r.id) &&
        r.hide_status !== "HIDDEN" &&
        (r.text || "").trim().length > 0
    );

    const perPostLimit = Math.min(config.maxRepliesPerPostPerRun, replyBudget);
    for (const reply of candidates.slice(0, perPostLimit)) {
      try {
        const replyText = await generateReply(
          { postText: post.text, commentAuthor: reply.username, commentText: reply.text, tone: TONE },
          replied.records
        );
        await createReply(userId, THREADS_ACCESS_TOKEN, { text: replyText, replyToId: reply.id });

        replied.ids.add(reply.id);
        replied.records.push({
          commentId: reply.id,
          mediaId: post.id,
          author: reply.username,
          commentText: (reply.text || "").slice(0, 200),
          replyText,
          repliedAt: now.toISOString(),
        });
        replyBudget--;
        discordLines.push(`✅ ${post.permalink}\n　@${reply.username}「${(reply.text || "").slice(0, 40)}」→ 「${replyText}」`);
      } catch (err) {
        console.error(`返信投稿に失敗(コメント ${reply.id}): ${err.message}`);
        discordLines.push(`⚠️ 返信失敗 (投稿 ${post.id} / コメント ${reply.id}): ${err.message}`);
      }
    }
  }

  saveReplied(replied.records);
  await postToDiscord(discordLines, newlyGrowing.length);

  console.log(
    `チェック完了。対象投稿 ${recentPosts.length}件 / 伸び検出 ${newlyGrowing.length}件 / 自動返信 ${config.maxRepliesPerRun - replyBudget}件`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
