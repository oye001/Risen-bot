"use strict";

const { Telegraf } = require("telegraf");
const Groq         = require("groq-sdk");
const express      = require("express");
const fs           = require("fs");
const path         = require("path");

const BOT_TOKEN    = process.env.BOT_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WEBHOOK_URL  = (process.env.WEBHOOK_URL || "").trim().replace(/\/+$/, "");
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
  mute:   "\u{1F507}",
  stop:   "\u{1F6D1}",
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
      lastCaMsgId:      null,
      lastCaMsgChat:    null,
      lastSilMsgId:     null,
      lastSilMsgChat:   null,
      lastWelMsgId:     null,
      lastWelMsgChat:   null,
      lastCaIdx:        -1,
      lastSilIdx:       -1,
      lastAiReplies:    [],
      lastActivity:     Date.now(),
      lastKnownChatId:  null,
      marketingLog:     {},
      fudWarnLog:       {},
      toxicWarnLog:     {},
    };
  }
}

function saveState(s) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(s)); } catch {}
}

const state = loadState();
if (!state.lastAiReplies)  state.lastAiReplies  = [];
if (!state.marketingLog)   state.marketingLog   = {};
if (!state.fudWarnLog)     state.fudWarnLog     = {};
if (!state.toxicWarnLog)   state.toxicWarnLog   = {};

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

// Silence breaker captions (3-5 lines)
const SILENCE_CAPTIONS = [
  E.cross + " He is risen, and $RISEN is still here.\n\n" +
  "While the group rests, the holders hold.\n" +
  "Contract renounced. LP locked. Nothing to fear.\n" +
  "Faith built this. Community will moon it. " + E.rocket,

  E.egg + " The quiet before the pump is always the loudest.\n\n" +
  "Diamond hands don\u2019t need conversation.\n" +
  "$RISEN was built for believers, not traders.\n" +
  "The faithful already got in. " + E.pray,

  E.fire + " $RISEN is an Easter coin with a resurrection thesis.\n\n" +
  "1 billion supply. 4.9% max wallet. 5/5 tax.\n" +
  "Renounced and locked from day one.\n" +
  "Hope, faith, and community. That\u2019s the play. " + E.cross,

  E.star + " Silence in the group means conviction on the chart.\n\n" +
  "Real holders don\u2019t panic sell. They wait.\n" +
  "$RISEN is patient. The resurrection always comes.\n" +
  "Stay in. Stay faithful. " + E.gem,

  E.rocket + " The dev is here. The community is here. $RISEN is here.\n\n" +
  "This isn\u2019t a rug. It\u2019s a revival.\n" +
  "Contract is renounced. LP is locked solid.\n" +
  "Easter meme season is just getting started. " + E.fire,

  E.pray + " Not every coin rises from the dead.\n\n" +
  "$RISEN was built with one purpose: resurrect your portfolio.\n" +
  "Community driven. Renounced. Locked.\n" +
  "The stone is rolled away. The next move is yours. " + E.chart,

  E.gem + " Strong hands hold through the silence.\n\n" +
  "The chart doesn\u2019t lie \u2014 $RISEN has room to run.\n" +
  "Dev is active. Team is watching. Community is building.\n" +
  "This Easter meme coin has a story to finish. " + E.crown,
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

async function muteUser(ctx, userId, seconds) {
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
      permissions: { can_send_messages: false },
      until_date: Math.floor(Date.now() / 1000) + seconds,
    });
  } catch {}
}

function isDuplicateReply(reply) {
  const norm = reply.toLowerCase().trim();
  return (state.lastAiReplies || []).some(r => r.toLowerCase().trim() === norm);
}

function recordReply(reply) {
  if (!state.lastAiReplies) state.lastAiReplies = [];
  state.lastAiReplies.push(reply);
  if (state.lastAiReplies.length > 12) state.lastAiReplies.shift();
  saveState(state);
}

// Marketing keyword detection
const MARKETING_PATTERN = /\b(market(ing)?|promo(tion)?|shill(ing)?|paid (promo|promotion|post)|collab(oration)?|partnership|adverti(se|sing|sement)|sponsor(ed)?|promotion)\b/i;

// FUD keyword detection
const FUD_PATTERN = /\b(rug|scam|fake|fraud|dead (coin|project)|shit(coin)?|garbage|trash|worthless|going to zero|dump(ing)?|exit scam|honeypot|avoid|stay away|don'?t buy|waste|ponzi|pyramid)\b/i;

// Toxic / bad language detection
const TOXIC_PATTERN = /\b(fuck|shit|ass(hole)?|bitch|bastard|dick|cunt|idiot|stupid|dumb(ass)?|moron|retard|loser|hate|kill (your)?self|stfu|shut (the fuck )?up|ugly|trash talk|kys)\b/i;

// Silence breaker
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

  const mention = user.username
    ? "@" + user.username
    : (user.first_name || "friend");

  let greeting = "";
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are welcoming a new member to the $RISEN Easter meme coin Telegram community. " +
            "Write 1-2 warm, genuine lines. The message already starts with the user's mention tag so do NOT include their name. " +
            "No URLs. No raw links. Max 1 emoji. Do not mention the CA or any links. " +
            "Never use: vibrant, embark, thrilling, feel free, do not hesitate. " +
            "Every welcome must feel completely different and human.",
        },
        {
          role: "user",
          content: "Generate a welcome for a new member.",
        },
      ],
      max_tokens: 70,
    });
    greeting = res.choices[0]?.message?.content?.trim() || "";
  } catch {
    greeting = E.cross + " Glad you\u2019re here. $RISEN is just getting started.";
  }

  const html =
    "<b>" + mention + "</b> " + greeting +
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

// Determine if message is about the project or dev
function isProjectRelated(text) {
  return /\b(risen|\$risen|dev(eloper)?|contract|token|coin|chart|price|buy|sell|launch|project|community|lp|liquidity|tax|wallet|renounce|lock(ed)?|supply|holder|pump|moon|when|how much|roadmap|plan|update|news|listing|cex|dex|pancake|dexscreen)\b/i.test(text);
}

// Main message handler
bot.on("message", async (ctx) => {
  const msg = ctx.message;
  if (!msg || !ctx.chat) return;

  const chatId = ctx.chat.id;
  const userId = msg.from?.id;

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

  // Anti-forward (non-admins)
  if (!admin && msg.forward_date) {
    try { await ctx.deleteMessage(); } catch {}
    try {
      const w = await ctx.reply(E.no + " Forwarded messages aren\u2019t allowed here.");
      setTimeout(() => safeDelete(chatId, w.message_id), 10000);
    } catch {}
    return;
  }

  // Anti-link (non-admins)
  if (!admin) {
    const hasLink  = /https?:\/\/|www\.|t\.me\//i.test(text);
    const hasExtAt = /@[a-zA-Z0-9_]{4,}/.test(text);
    if (hasLink || hasExtAt) {
      try { await ctx.deleteMessage(); } catch {}
      try {
        const w = await ctx.reply(E.warn + " Links and external usernames aren\u2019t allowed here.");
        setTimeout(() => safeDelete(chatId, w.message_id), 10000);
      } catch {}
      return;
    }
  }

  // Anti-spam (non-admins)
  if (!admin) {
    const now = Date.now();
    spamMap[userId] = (spamMap[userId] || []).filter(t => now - t < 60000);
    spamMap[userId].push(now);
    if (spamMap[userId].length > 5) {
      try { await ctx.deleteMessage(); } catch {}
      try {
        await muteUser(ctx, userId, 300);
        const w = await ctx.reply(E.no + " Slow down. You\u2019ve been muted for 5 minutes.");
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
  }

  // Marketing spam (non-admins) - 2 mentions = 3 day mute
  if (!admin && MARKETING_PATTERN.test(text)) {
    const key = String(userId);
    state.marketingLog[key] = (state.marketingLog[key] || 0) + 1;
    saveState(state);
    if (state.marketingLog[key] === 1) {
      try {
        const w = await ctx.reply(
          E.warn + " No unsolicited marketing or promotions here. Next time you\u2019ll be muted."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
    if (state.marketingLog[key] >= 2) {
      state.marketingLog[key] = 0;
      saveState(state);
      try { await ctx.deleteMessage(); } catch {}
      try {
        await muteUser(ctx, userId, 3 * 24 * 60 * 60);
        const w = await ctx.reply(
          E.mute + " Muted for 3 days. No marketing or promotions allowed in this group."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
  }

  // FUD detection (non-admins) - warn then 1 hour mute
  if (!admin && FUD_PATTERN.test(text)) {
    const key = String(userId);
    state.fudWarnLog[key] = (state.fudWarnLog[key] || 0) + 1;
    saveState(state);
    if (state.fudWarnLog[key] === 1) {
      try {
        const w = await ctx.reply(
          E.warn + " Keep it positive. FUD and negative talk about the project aren\u2019t welcome here. Final warning."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
    if (state.fudWarnLog[key] >= 2) {
      state.fudWarnLog[key] = 0;
      saveState(state);
      try { await ctx.deleteMessage(); } catch {}
      try {
        await muteUser(ctx, userId, 60 * 60);
        const w = await ctx.reply(
          E.mute + " Muted for 1 hour. Spreading FUD about $RISEN isn\u2019t tolerated here."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
  }

  // Toxic / bad language (non-admins) - warn then 1 hour mute
  if (!admin && TOXIC_PATTERN.test(text)) {
    const key = String(userId);
    state.toxicWarnLog[key] = (state.toxicWarnLog[key] || 0) + 1;
    saveState(state);
    if (state.toxicWarnLog[key] === 1) {
      try {
        const w = await ctx.reply(
          E.warn + " This is a respectful community. Keep it clean and kind. Final warning."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
    if (state.toxicWarnLog[key] >= 2) {
      state.toxicWarnLog[key] = 0;
      saveState(state);
      try { await ctx.deleteMessage(); } catch {}
      try {
        await muteUser(ctx, userId, 60 * 60);
        const w = await ctx.reply(
          E.mute + " Muted for 1 hour. Hate and bad language have no place in this community."
        );
        setTimeout(() => safeDelete(chatId, w.message_id), 15000);
      } catch {}
      return;
    }
  }

  // Commands
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

  // Ignore pure hype / reactions
  const ignoreWords = new RegExp(
    "^(gm|gn|lol|nice|wow|ok|okay|based|fr|lfg|wagmi|ser|soon|" +
    "ngmi|hodl|hodling|anon|fren|chad|gg|lmao|haha|lmfao|" +
    "send it|lets go|diamond hands|up only|gm fam|blessed|" +
    "glory|amen|hallelujah|praise|thnx|thx|ty|np|sure|cool|" +
    "yes|no|maybe|idk|same|facts|true|real|legend|king|queen)$",
    "i"
  );
  if (ignoreWords.test(lower)) return;

  // Respond to project-related messages AND genuine questions
  const isQuestion   = text.includes("?") ||
    /^(what|how|when|who|where|why|is |are |can |does |do |will |was |has |have )/i.test(lower);
  const aboutProject = isProjectRelated(text);

  if (!isQuestion && !aboutProject) return;

  // AI reply
  try {
    const recentReplies = (state.lastAiReplies || []).slice(-6).join("\n---\n");

    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are the community assistant for $RISEN (HE IS RISEN), an Easter meme coin on BNB Smart Chain.\n" +
            "Total supply: 1,000,000,000. Max wallet: 4.9%. Buy tax: 5%. Sell tax: 5%.\n" +
            "Contract is renounced. LP is locked.\n" +
            "The developer is ACTIVE, present, and engaged with the community every single day.\n" +
            "Narrative: The Easter Meme Coin powered by hope, faith, and community.\n" +
            "Personality: Calm, confident, warm, real. Never corporate or stiff.\n" +
            "Never use: vibrant, embark, thrilling, feel free, do not hesitate.\n" +
            "Short messages = 1-3 lines. Detailed questions = up to 5 lines.\n" +
            "Minimal emojis. Never output raw URLs. Never volunteer the CA unprompted.\n" +
            "CRITICAL: Every reply must be completely unique in structure and wording. Never echo or repeat a previous reply.\n" +
            "Recent replies to avoid repeating:\n" + recentReplies + "\n" +
            "If the message has absolutely nothing to do with the project or community, reply with exactly: __IGNORE__",
        },
        { role: "user", content: text },
      ],
      max_tokens: 200,
    });

    const reply = res.choices[0]?.message?.content?.trim();
    if (!reply || reply.length <= 2 || reply === "__IGNORE__") return;
    if (isDuplicateReply(reply)) return;

    await ctx.reply(reply);
    recordReply(reply);
  } catch {}
});

// Express + webhook
app.get("/",        (_, res) => res.send("OK"));
app.get("/health",  (_, res) => res.send("OK"));
app.post("/webhook", (req, res) => bot.handleUpdate(req.body, res));

app.listen(PORT, () => {
  console.log("Risen Bot running on port " + PORT);
  setTimeout(async () => {
    const target = WEBHOOK_URL + "/webhook";
    console.log("Setting webhook: " + target);
    let attempts = 0;
    const trySet = async () => {
      try {
        await bot.telegram.setWebhook(target);
        console.log("Webhook set: " + target);
      } catch (e) {
        attempts++;
        console.error("Webhook attempt " + attempts + " failed: " + e.message);
        if (attempts < 5) setTimeout(trySet, 5000);
      }
    };
    await trySet();
  }, 2000);
});
