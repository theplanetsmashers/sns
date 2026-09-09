// lib/sceneTimeline.js
// シーンごとの音声の長さから、クロスフェード結合後の最終動画内での各シーンの開始・終了時刻を計算する。
// buildVideo.js(実際のクロスフェード結合)とbuildCaptions.js(字幕の表示タイミング)の両方から、
// 同じタイミング計算を共有して使うためのモジュール。

const TRANSITION_SECONDS = 0.4; // シーン間のクロスフェードの長さ(30秒程度の短い動画なので少し短めにする)

function computeSceneTimeline(durations, transitionSeconds = TRANSITION_SECONDS) {
  const timeline = [];
  let running = 0;

  for (let i = 0; i < durations.length; i++) {
    if (i === 0) {
      timeline.push({ start: 0, end: durations[0] });
      running = durations[0];
      continue;
    }
    const t = Math.min(transitionSeconds, durations[i - 1], durations[i]) / 2 || 0.1;
    const start = Math.max(running - t, 0);
    const end = start + durations[i];
    timeline.push({ start, end });
    running = running + durations[i] - t;
  }

  return timeline;
}

module.exports = { computeSceneTimeline, TRANSITION_SECONDS };
