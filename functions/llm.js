// Cloudflare Pages Function —— 路径 /llm
// 放在项目的 functions/llm.js
// 作用：转发 DeepSeek，密钥只在服务端。
//   · 单轮（决策速写）：前端 POST {system, user, max_tokens, temperature}
//   · 多轮（决策副驾）：前端 POST {system, messages:[{role,content}...], max_tokens, temperature}
// 需要在 Pages 项目里配置环境变量： DEEPSEEK_KEY （可选 DEEPSEEK_MODEL，默认 deepseek-v4-pro）

const cors = { "Access-Control-Allow-Origin": "*" };
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

export async function onRequestPost({ request, env }) {
  const KEY = env.DEEPSEEK_KEY;
  if (!KEY) return json({ error: "服务端未配置 DEEPSEEK_KEY" }, 500);
  try {
    const { system, user, messages, max_tokens = 1500, temperature = 0.3 } = await request.json();

    // 组装 messages：
    // · 决策副驾（多轮）：传 { system, messages:[...] } —— 把 system 拼到完整对话前
    // · 决策速写（单轮）：传 { system, user } —— 退回原来的 system + user
    let msgs;
    if (Array.isArray(messages) && messages.length) {
      msgs = system ? [{ role: "system", content: system }, ...messages] : messages;
    } else {
      msgs = [
        { role: "system", content: system || "" },
        { role: "user", content: user || "" },
      ];
    }

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-v4-pro",
        max_tokens, temperature,
        messages: msgs,
      }),
    });
    if (!res.ok) return json({ error: `DeepSeek ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    return json(await res.json());
  } catch (e) {
    return json({ error: "代理异常：" + (e?.message || e) }, 500);
  }
}
