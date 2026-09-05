// test/helpers/mock-fetch.js
// Anthropic / Google / Slack のHTTP APIをスタブ化するテスト用ヘルパー。
// 実際のネットワーク呼び出し・API課金なしで、各スクリプトのロジックを検証するために使う。

function textResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: "text", text }] }),
    text: async () => text,
  };
}

function jsonResponse(obj, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// prompt本文にマッチする条件と、返すテキストのペアを渡してモックを組み立てる。
// 順番に評価し、最初にマッチしたものを使う。
function installMockFetch(anthropicRules = []) {
  const original = global.fetch;

  global.fetch = async (url, opts = {}) => {
    const urlStr = String(url);

    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "mock-access-token", expires_in: 3600 });
    }

    if (urlStr.includes("googleapis.com/drive/v3/files") || urlStr.includes("googleapis.com/upload/drive/v3/files")) {
      if ((opts.method || "GET") === "GET") return jsonResponse({ files: [] });
      return jsonResponse({ id: "mock-id-" + Math.random().toString(16).slice(2) });
    }

    if (urlStr.includes("hooks.slack.com") || urlStr.includes("discord.com")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "ok" };
    }

    if (urlStr.startsWith("https://slack.com/api/")) {
      const method = urlStr.replace("https://slack.com/api/", "");
      if (method === "conversations.open") return jsonResponse({ ok: true, channel: { id: "D123" } });
      if (method === "users.info") return jsonResponse({ ok: true, user: { real_name: "テスト太郎", name: "test" } });
      return jsonResponse({ ok: true });
    }

    if (urlStr.includes("api.anthropic.com")) {
      const body = JSON.parse(opts.body);
      const prompt = body.messages[0].content;

      for (const rule of anthropicRules) {
        if (rule.match(prompt)) return textResponse(rule.reply(prompt));
      }

      // デフォルト: analyzeAnswer形式のJSONを機械的に返す
      if (prompt.includes('"needs_followup"')) {
        return textResponse(
          JSON.stringify({
            needs_followup: false,
            followup_question: "",
            summary: "(mock要約)",
            richness_score: 3,
          })
        );
      }

      throw new Error("mock-fetch: unhandled Anthropic prompt: " + prompt.slice(0, 100));
    }

    throw new Error("mock-fetch: unhandled url: " + urlStr);
  };

  return function restore() {
    global.fetch = original;
  };
}

module.exports = { installMockFetch, textResponse, jsonResponse };
