"use strict";

const { Telegraf } = require("telegraf");
const Groq         = require("groq-sdk");
const express      = require("express");
const fs           = require("fs");
const path         = require("path");

const BOT_TOKEN    = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_URL  = process.env.WEBHOOK_URL;
const PORT         = process.env.PORT || 3000;

const bot  = new Telegraf(BOT_TOKEN);
const groq = new Groq({ apiKey: GROQ_API_KEY });
const app  = express();
app.use(express.json());

// Emoji map (pure ASCII source, unicode escapes only)
const E = {
  cross:  "\u271D\uFE0F",
  rocket: "\u{1F680}",
  pray:   "\u{1F64F}",
  fire:   "\u{1F525}",
  egg:    "\u{1F95A}",
  star:   "\u2728",
  chart:  "\u{1F4C8}",
  gem:    "\u{1F48E}",
  coin:   "\u{1FA99}",
  sun:    "\u{1F31E}",
  crown:  "\u{1F451}",
  check:  "\u2705",
  lock:   "\u{1F512}",
  angel:  "\u{1F47C}",
  globe:  "\u{1F310}",
  warn:   "\u26A0\uFE0F",
  no:     "\u{1F6AB}",
  copy:   "\u{1F4CB}",
};

// Token config
const CA          = "0x8cc3635383465e61c21eed59f0fca7ac753b833a";
const DEXSCREENER = "https://dexscreener.com/bsc/" + CA;
const PANCAKESWAP = "https://pancakeswap.finance/swap?outputCurrency=" + CA;
const TWITTER     = "https://x.com/RISENportal";
const IMAGE_PATH  = path.join(__dirname, "risen.jpg");
const STATE_PATH  = "/tmp/risen_state.json";

// State
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch {
    return {
      lastCaMsgId:     null,
      lastCaMsgChat:   null,
      lastSilMsgId:    null,
      lastSilMsgChat:  null,
      lastWelMsgId:    null,
      lastWelMsgChat:  null,
      lastCaIdx:       -1,
      lastSilIdx:      -1,
      lastActivity:    Date.now(),
      lastKnownChatId: null,
    };
  }
}

function saveState(s) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(s)); } catch {}
}

const state = loadState();
let lastActivity = state.lastActivity || Date.now();

// Rotating CA captions
const CA_OPENERS = [
  E.cross + " He is risen. And so is the contract.",
  E.egg   + " The stone is rolled away. The CA is revealed.",
  E.sun   + " A new dawn. A new coin. Here\u2019s the address.",
  E.fire  + " Community confirmed the resurrection. Here\u2019s proof.",
  E.pray  + " Faith brought you here. The CA will take you further.",
  E.angel + " Straight from the tomb to your wallet.",
  E.star  + " The Easter coin has a home on chain.",
];

const CA_CLOSERS = [
  "HODL for the resurrection. "            + E.rocket,
  "Copy it. Trust it. Hold it. "           + E.gem,
  "The faithful get in early. "            + E.cross,
  "Built on faith, locked in faith. "      + E.lock,
  "Verify. Buy. Believe. "                 + E.check,
  "He rose. Your portfolio can too. "      + E.chart,
  "Contract renounced. Community sealed. " + E.pray,
];

// Silence breaker captions
const SILENCE_CAPTIONS = [
  E.cross  + " Still here. Still risen. $RISEN doesn\u2019t sleep.",
  E.rocket + " Quiet group, strong hands. That\u2019s how winners are made.",
  E.fire   + " The community is holding. The chart will follow.",
  E.egg    + " Easter came. $RISEN stayed. Diamond hands only.",
  E.pray   + " Faith over fear. $RISEN is built different.",
  E.star   + " Every resurrection starts with silence. Then the pump.",
  E.gem    + " Real ones hold through the quiet. $RISEN.",
];

// Helpers
function pickIdx(arr, last) {
  let i;
  do { i = Math.floor(Math.random() * arr.length); }
  while (i === last && arr.length > 1);
  return i;
}

async function safeDelete(chatId, msgId) {
  if (!chatId || !msgId) return;
  try { await bot.telegram.deleteMessage(chatId, msgId); } catch {}
}

async function isAdmin(ctx, userId) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ["administrator", "creator"].includes(m.status);
  } catch { return false; }
}

// Silence breaker - checks every 60 seconds
setInterval(async () => {
  if (!state.lastKnownChatId) return;
  if (Date.now() - lastActivity < 30 * 60 * 1000) return;

  const idx = pickIdx(SILENCE_CAPTIONS, state.lastSilIdx);
  state.lastSilIdx = idx;

  await safeDelete(state.lastSilMsgChat, state.lastSilMsgId);

  try {
    const sent = await bot.telegram.sendPhoto(
      state.lastKnownChatId,
      { source: fs.createReadStream(IMAGE_PATH) },
      { caption: SILENCE_CAPTIONS[idx] }
    );
    state.lastSilMsgId   = sent.message_id;
    state.lastSilMsgChat = state.lastKnownChatId;
    lastActivity         = Date.now();
    state.lastActivity   = lastActivity;
    saveState(state);
  } catch {}
}, 60 * 1000);

// Anti-spam tracker
const spamMap = {};

// CA handler
async function handleCA(ctx) {
  const chatId = ctx.chat.id;
  await safeDelete(state.lastCaMsgChat, state.lastCaMsgId);

  const oi = pickIdx(CA_OPENERS, state.lastCaIdx);
  const ci = pickIdx(CA_CLOSERS, -1);
  state.lastCaIdx = oi;

  const caption = CA_OPENERS[oi] + "\n\n" + CA + "\n\n" + CA_CLOSERS[ci];

  try {
    const sent = await bot.telegram.sendPhoto(
      chatId,
      { source: fs.createReadStream(IMAGE_PATH) },
      {
        caption,
        reply_markup: {
          inline_keyboard: [[
            { text: E.copy + " Copy CA", copy_text: { text: CA } },
          ]],
        },
      }
    );
    state.lastCaMsgId   = sent.message_id;
    state.lastCaMsgChat = chatId;
    saveState(state);
  } catch {}
}

// Socials handler
async function handleSocials(ctx) {
  const html =
    "<b>" + E.globe + " $RISEN Official Links</b>\n\n" +
    E.chart + " <a href=\"" + DEXSCREENER + "\">Chart on DexScreener</a>\n" +
    E.coin  + " <a href=\"" + PANCAKESWAP + "\">Buy on PancakeSwap</a>\n" +
    E.cross + " <a href=\"" + TWITTER     + "\">Follow on X</a>\n\n" +
    "Always verify links before connecting your wallet.";
  try {
    await ctx.replyWithHTML(html, { disable_web_page_preview: true });
  } catch {}
}

// Twitter handler
async function handleTwitter(ctx) {
  const caption = E.cross + " Follow the resurrection. $RISEN is live on X.";
  try {
    await bot.telegram.sendPhoto(
      ctx.chat.id,
      { source: fs.createReadStream(IMAGE_PATH) },
      {
        caption,
        reply_markup: {
          inline_keyboard: [[
            { text: E.cross + " Follow on X", url: TWITTER },
          ]],
        },
      }
    );
  } catch {}
}

// New member welcome
async function handleNewMember(ctx, user) {
  const chatId = ctx.chat.id;

  await safeDelete(state.lastWelMsgChat, state.lastWelMsgId);
  state.lastWelMsgId   = null;
  state.lastWelMsgChat = null;

  let greeting = "";
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are welcoming a new member to the $RISEN Easter meme coin Telegram community. " +
            "Write 1-2 warm, genuine lines greeting them by first name. " +
            "No URLs. No raw links. Max 1 emoji. Do not mention the CA or any links.",
        },
        {
          role: "user",
          content: "New member joining: " + (user.first_name || "friend"),
        },
      ],
      max_tokens: 70,
    });
    greeting = res.choices[0]?.message?.content?.trim() || "";
  } catch {
    greeting =
      "Welcome to $RISEN, " + (user.first_name || "friend") +
      ". " + E.cross + " Glad you\u2019re here.";
  }

  const html =
    greeting +
    "\n\n" +
    "<a href=\"" + DEXSCREENER + "\">Chart</a> | <a href=\"" + PANCAKESWAP + "\">Buy</a>" +
    "\n\nCA: <code>" + CA + "</code>";

  try {
    const sent = await bot.telegram.sendMessage(chatId, html, { parse_mode: "HTML" });
    state.lastWelMsgId   = sent.message_id;
    state.lastWelMsgChat = chatId;
    saveState(state);

    setTimeout(async () => {
      await safeDelete(chatId, sent.message_id);
      if (state.lastWelMsgId === sent.message_id) {
        state.lastWelMsgId = null;
        saveState(state);
      }
    }, 60000);
  } catch {}
}

// Main message handler
bot.on("message", async (ctx) => {
  const msg = ctx.message;
  if (!msg || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const userId = msg.from?.id;

  // Update activity and last known chat
  lastActivity          = Date.now();
  state.lastActivity    = lastActivity;
  state.lastKnownChatId = chatId;
  saveState(state);

  // New member service message
  if (msg.new_chat_members) {
    try { await ctx.deleteMessage(); } catch {}
    for (const user of msg.new_chat_members) {
      if (user.is_bot) continue;
      await handleNewMember(ctx, user);
    }
    return;
  }

  const text  = (msg.text || "").trim();
  const lower = text.toLowerCase();

  if (!text || !userId) return;

  const admin = await isAdmin(ctx, userId);

  // Anti-link (non-admins only)
  if (!admin) {
    const hasLink  = /https?:\/\/|www\.|t\.me\//i.test(text);
    const hasExtAt = /@[a-zA-Z0-9_]{4,}/.test(text);
    if (hasLink || hasExtAt) {
      try { await ctx.deleteMessage(); } catch {}
      try {
        const w = await ctx.reply(
          E.warn + " Links and external usernames aren\u2019t allowed here."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 10000);
      } catch {}
      return;
    }
  }

  // Anti-spam (non-admins only)
  if (!admin) {
    const now = Date.now();
    spamMap[userId] = (spamMap[userId] || []).filter(t => now - t < 60000);
    spamMap[userId].push(now);
    if (spamMap[userId].length > 5) {
      try { await ctx.deleteMessage(); } catch {}
      try {
        await ctx.telegram.restrictChatMember(chatId, userId, {
          permissions: { can_send_messages: false },
          until_date: Math.floor(now / 1000) + 300,
        });
        const w = await ctx.reply(
          E.no + " Slow down. You\u2019ve been muted for 5 minutes."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
  }

  // Commands - available to everyone including admins
  if (/^(ca|\/ca|contract|address|addy)$/i.test(lower)) {
    await handleCA(ctx); return;
  }
  if (/^(socials|\/socials|links|\/links)$/i.test(lower)) {
    await handleSocials(ctx); return;
  }
  if (/^(x|\/x|twitter|\/twitter)$/i.test(lower)) {
    await handleTwitter(ctx); return;
  }

  // Never AI-reply to admins
  if (admin) return;

  // Ignore hype, casual chat, short reactions
  const ignoreWords = new RegExp(
    "^(gm|gn|lol|nice|wow|ok|okay|based|fr|lfg|wagmi|moon|pump|ser|wen|soon|" +
    "ngmi|hodl|hodling|hold|holding|bullish|bearish|anon|fren|chad|gg|" +
    "send it|to the moon|lets go|lmao|haha|lmfao|" +
    "diamond hands|up only|buy|sell|wen pump|blessed|risen|he is risen|" +
    "glory|amen|hallelujah|praise)$",
    "i"
  );
  if (ignoreWords.test(lower)) return;

  // Only answer genuine questions
  const isQuestion =
    text.includes("?") ||
    /^(what|how|when|who|where|why|is |are |can |does |do |will |was |has |have )/i.test(lower);
  if (!isQuestion) return;

  // AI reply
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are the community assistant for $RISEN (HE IS RISEN), an Easter meme coin on BNB Smart Chain.\n" +
            "Total supply: 1,000,000,000. Max wallet: 4.9%. Buy tax: 5%. Sell tax: 5%.\n" +
            "Contract is renounced. LP is locked.\n" +
            "Narrative: The Easter Meme Coin powered by hope, faith, and community.\n" +
            "Personality: Calm, confident, warm, real. Never corporate or stiff.\n" +
            "Never use the words: vibrant, embark, thrilling, feel free, do not hesitate.\n" +
            "Short questions = 1-3 lines. Detailed questions = up to 5 lines.\n" +
            "Minimal emojis. Never output raw URLs. Never volunteer the CA.\n" +
            "Every reply must feel different every time.\n" +
            "If the message is not a genuine project question, reply with exactly: __IGNORE__",
        },
        { role: "user", content: text },
      ],
      max_tokens: 200,
    });
    const reply = res.choices[0]?.message?.content?.trim();
    if (reply && reply.length > 2 && reply !== "__IGNORE__") {
      await ctx.reply(reply);
    }
  } catch {}
});

// Express server + webhook setup
app.get("/",        (_, res) => res.send("OK"));
app.get("/health",  (_, res) => res.send("OK"));
app.post("/webhook", (req, res) => bot.handleUpdate(req.body, res));

app.listen(PORT, async () => {
  console.log("Risen Bot running on port " + PORT);
  try {
    await bot.telegram.setWebhook(WEBHOOK_URL + "/webhook");
    console.log("Webhook set: " + WEBHOOK_URL + "/webhook");
  } catch (e) {
    console.error("Webhook error:", e.message);
  }
});
