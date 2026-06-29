// Cloudflare Pages Function —— 路径 /ocr
// 放在项目的 functions/ocr.js
// 作用：服务端跑完飞桨「提交→轮询→取 JSONL」三步，前端只发一次图、拿回 {text}。
// 需要在 Pages 项目里配置环境变量： PADDLE_TOKEN

const JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const MODEL = "PaddleOCR-VL-1.6";
const cors = { "Access-Control-Allow-Origin": "*" };
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}

export async function onRequestPost({ request, env }) {
  const TOKEN = env.PADDLE_TOKEN;
  if (!TOKEN) return json({ error: "服务端未配置 PADDLE_TOKEN" }, 500);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file) return json({ error: "没有收到文件" }, 400);

    const auth = { Authorization: `bearer ${TOKEN}` };

    // 1) 提交任务
    const out = new FormData();
    out.append("model", MODEL);
    out.append("optionalPayload", JSON.stringify({
      useDocOrientationClassify: false, useDocUnwarping: false, useChartRecognition: false,
    }));
    out.append("file", file, file.name || "upload");
    const submit = await fetch(JOB_URL, { method: "POST", headers: auth, body: out });
    if (!submit.ok) return json({ error: `提交失败 ${submit.status}: ${(await submit.text()).slice(0, 200)}` }, 502);
    const jobId = (await submit.json())?.data?.jobId;
    if (!jobId) return json({ error: "没拿到 jobId" }, 502);

    // 2) 轮询（最多 ~75s，够单张图/小文件；超大多页文档可能超时）
    let jsonUrl = "";
    for (let i = 0; i < 25; i++) {
      await sleep(3000);
      const q = await fetch(`${JOB_URL}/${jobId}`, { headers: auth });
      if (!q.ok) continue;
      const d = (await q.json())?.data || {};
      if (d.state === "done") { jsonUrl = d.resultUrl?.jsonUrl; break; }
      if (d.state === "failed") return json({ error: d.errorMsg || "识别失败" }, 502);
    }
    if (!jsonUrl) return json({ error: "识别超时（大文件需改前端轮询方案）" }, 504);

    // 3) 取 JSONL，抽 markdown
    const jsonl = await (await fetch(jsonUrl)).text();
    const parts = [];
    for (const line of jsonl.trim().split("\n")) {
      if (!line.trim()) continue;
      let obj; try { obj = JSON.parse(line); } catch { continue; }
      const result = obj.result || obj;
      for (const res of (result.layoutParsingResults || [])) {
        const md = res.markdown;
        parts.push(typeof md === "string" ? md : (md?.text || ""));
      }
    }
    return json({ text: parts.join("\n\n").trim() });
  } catch (e) {
    return json({ error: "代理异常：" + (e?.message || e) }, 500);
  }
}
