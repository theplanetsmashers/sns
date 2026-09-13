// lib/growth.js
// 「伸びている投稿」かどうかの判定ロジック。
// 前回チェック時からの閲覧数の増分(絶対数 or 増加率)がしきい値を超えたら「伸びている」と判定する。
// 一度伸びていると判定された投稿は、GROWTH_STICKY_HOURS の間は
// (その後の増分が小さくても)コメント返信の対象であり続ける。
// これは、伸び始めた直後に届いたコメントを取りこぼさないようにするため。

function isGrowing(prevInsights, currentInsights, config) {
  if (!prevInsights) return false; // 初回観測はベースライン記録のみで判定しない
  const deltaViews = (currentInsights.views || 0) - (prevInsights.views || 0);
  if (deltaViews <= 0) return false;
  const rate = prevInsights.views > 0 ? deltaViews / prevInsights.views : Infinity;
  return deltaViews >= config.growthMinViewsDelta || rate >= config.growthMinRate;
}

function updatePostState(entry, post, insights, config, now) {
  const history = entry.history || [];
  const prev = history[history.length - 1] || null;
  const growingNow = isGrowing(prev, insights, config);

  history.push({ at: now.toISOString(), ...insights });

  const growingUntil =
    growingNow ? now.getTime() + config.growthStickyHours * 3600 * 1000 : entry.growingUntil || 0;

  return {
    text: post.text,
    permalink: post.permalink,
    timestamp: post.timestamp,
    history,
    growingUntil,
    lastCheckedAt: now.toISOString(),
    justDetectedGrowth: growingNow,
  };
}

module.exports = { isGrowing, updatePostState };
