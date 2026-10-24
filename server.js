// server.js - Velvet Chat Server (AM Edition)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { check } = require('./filter');

// ⚙️ CONFIGURATION
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1563440789143556106/8yfXJv7YDnYtz-BCWNq3Mfpabkhx3QDjID3YkGodWvzDY8kC34TCELcB3yiASRFFKbmP';
const ADMIN_SECRET = 'velvet_secret_123';
const MY_WEBSITE_URL = 'https://velvet-chat-x04m.onrender.com';

const PORT = process.env.PORT || 3000;
const TABLE_MS = 10 * 60 * 1000;      // 10 นาที
const IDLE_THRESHOLD_MS = 30 * 1000; 
const REMATCH_AFTER_MS = 15 * 1000;  
const MAX_LEN = 500;
const MIN_GAP_MS = 400;              
const MAX_STRIKES = 3;               
const STRIKE_WINDOW_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 1000;   

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const bannedIPs = new Map(); 

const ANIMALS = [
  ['สุนัข', '🐶'], ['แมว', '🐱'], ['หนู', '🐭'], ['กระต่าย', '🐰'],
  ['สุนัขจิ้งจอก', '🦊'], ['หมี', '🐻'], ['แพนด้า', '🐼'], ['โคอาลา', '🐨'],
  ['เสือ', '🐯'], ['สิงโต', '🦁'], ['วัว', '🐮'], ['หมู', '🐷'],
  ['ลิง', '🐵'], ['ม้า', '🐴'], ['แกะ', '🐑'], ['อูฐ', '🐪'],
  ['ยีราฟ', '🦒'], ['ช้าง', '🐘'], ['แรด', '🦏'], ['ม้าลาย', '🦓'],
  ['กวาง', '🦌'], ['จิงโจ้', '🦘'], ['นกอินทรี', '🦅'], ['เป็ด', '🦆'],
  ['หงส์', '🦢'], ['นกฮูก', '🦉'], ['นกฟลามิงโก', '🦩'], ['นกยูง', '🦚'],
  ['นกแก้ว', '🦜'], ['เพนกวิน', '🐧'], ['กบ', '🐸'], ['จระเข้', '🐊'],
  ['เต่า', '🐢'], ['กิ้งก่า', '🦎'], ['งู', '🐍'], ['วาฬ', '🐳'],
  ['โลมา', '🐬'], ['ฉลาม', '🦈'], ['ปลา', '🐟'], ['ปลาหมึก', '🐙'],
  ['ปู', '🦀'], ['กุ้ง', '🦐'], ['ผีเสื้อ', '🦋'], ['ผึ้ง', '🐝'],
  ['เต่าทอง', '🐞'], ['แมงมุม', '🕷️']
];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const users = new Map();  
const tables = new Map(); 
let queue = [];
let tableSeq = 0;

function newUser(socket, ip) {
  const [animal, emoji] = pick(ANIMALS);
  return {
    id: socket.id, socket, ip, emoji, nick: animal, 
    status: '🌧️ เหงา', music: '', state: 'idle', tableId: null, since: 0, recent: null, lastMsg: 0, seq: 0,
    strikes: [], banUntil: 0, reportCount: 0
  };
}

function otherOf(u) {
  const t = tables.get(u.tableId);
  if (!t) return null;
  return users.get(t.a === u.id ? t.b : t.a) || null;
}

function enqueue(u) {
  if (u.state === 'waiting') return;
  u.state = 'waiting';
  u.since = Date.now();
  queue.push(u.id);
  u.socket.emit('waiting');
  tryMatch();
}

const dequeue = (id) => { queue = queue.filter((x) => x !== id); };

function canPair(a, b) {
  const fresh = a.recent === b.id || b.recent === a.id;
  if (!fresh) return true;
  const now = Date.now();
  return now - a.since > REMATCH_AFTER_MS && now - b.since > REMATCH_AFTER_MS;
}

function tryMatch() {
  queue = queue.filter((id) => users.get(id)?.state === 'waiting');
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const a = users.get(queue[i]);
      const b = users.get(queue[j]);
      if (!canPair(a, b)) continue;
      queue.splice(j, 1);
      queue.splice(i, 1);
      openTable(a, b);
      return tryMatch();
    }
  }
}

function openTable(a, b) {
  const t = {
    id: ++tableSeq, a: a.id, b: b.id,
    remainingMs: TABLE_MS,
    lastInteraction: Date.now(),
    isSpeedUp: false,
    timer: null,
    extendVotes: new Map(),
    logs: [] 
  };

  t.timer = setInterval(() => updateTableTimer(t), 1000);
  tables.set(t.id, t);

  for (const [me, other] of [[a, b], [b, a]]) {
    me.state = 'seated';
    me.tableId = t.id;
    me.seq = 0;
    me.socket.emit('seated', {
      partner: other.nick, emoji: other.emoji, status: other.status, music: other.music, ms: TABLE_MS, total: TABLE_MS,
    });
  }
}

function updateTableTimer(t) {
  const now = Date.now();
  const idleTime = now - t.lastInteraction;
  
  t.isSpeedUp = idleTime > IDLE_THRESHOLD_MS;
  const decrement = t.isSpeedUp ? 2000 : 1000;
  t.remainingMs -= decrement;

  if (t.remainingMs <= 0) {
    t.remainingMs = 0;
    clearInterval(t.timer);
    io.to(t.a).emit('time-expired');
    io.to(t.b).emit('time-expired');
    return;
  }

  io.to(t.a).emit('timer-tick', { ms: t.remainingMs, speedUp: t.isSpeedUp });
  io.to(t.b).emit('timer-tick', { ms: t.remainingMs, speedUp: t.isSpeedUp });
}

function closeTable(t, reason, actorId) {
  if (!tables.has(t.id)) return;
  clearInterval(t.timer);
  tables.delete(t.id);
  for (const id of [t.a, t.b]) {
    const u = users.get(id);
    if (!u) continue;
    const isActor = id === actorId;
    u.tableId = null;
    u.state = 'idle';
    u.recent = id === t.a ? t.b : t.a;
    if ((reason === 'leave' || reason === 'violations') && isActor) {
      u.socket.emit('ended', { reason, self: true });
      continue;
    }
    let r = reason;
    if (reason === 'report') r = isActor ? 'report' : 'partner-left';
    if (reason === 'violations') r = 'partner-left';
    u.socket.emit('ended', { reason: r });
    enqueue(u);
  }
}

// 🛡️ ตัวแปรควบคุมการหน่วงเวลาป้องกัน Status 429
let lastWebhookSendTime = 0;

function sendDiscordReport(reportData) {
  if (!DISCORD_WEBHOOK_URL || DISCORD_WEBHOOK_URL.trim() === '') return;

  // หน่วงเวลา 5 วินาทีก่อนส่งแต่ละรอบ ป้องกัน Rate Limit (429)
  const now = Date.now();
  if (now - lastWebhookSendTime < 5000) {
    console.log('⏳ [Discord Webhook] หน่วงเวลาป้องกัน Rate Limit (429)');
    return;
  }
  lastWebhookSendTime = now;

  const targetIp = reportData.target.ip || 'Unknown';
  const banLink1Hr = `${MY_WEBSITE_URL}/admin/ban?ip=${targetIp}&key=${ADMIN_SECRET}&duration=60`;
  const banLink24Hr = `${MY_WEBSITE_URL}/admin/ban?ip=${targetIp}&key=${ADMIN_SECRET}&duration=1440`;

  const logsText = (reportData.logs && reportData.logs.length > 0)
    ? reportData.logs.map(m => `**[${m.sender}]**: ${m.text}`).join('\n')
    : '_ไม่มีข้อความสนทนา_';

  const payload = {
    username: "VELVET CHAT - SECURITY BOT",
    embeds: [
      {
        title: "🚨 มีรายงานพฤติกรรมไม่เหมาะสม (NEW REPORT)",
        color: 0xff4444,
        fields: [
          { name: "👤 ผู้กดรายงาน", value: `${reportData.reporter.emoji} ${reportData.reporter.nick}`, inline: true },
          { name: "🚫 ผู้ถูกรายงาน", value: `${reportData.target.emoji} ${reportData.target.nick}\n\`IP: ${targetIp}\``, inline: true },
          { name: "📌 สาเหตุ", value: `**${reportData.reason}**`, inline: false },
          { name: "💬 ประวัติการคุยย้อนหลัง (Chat Logs)", value: logsText.slice(0, 1000), inline: false },
          { name: "⚡ ปุ่มจัดการแอดมิน (Quick Ban)", value: `👉 [🚫 แบน IP นี้ 1 ชั่วโมง](${banLink1Hr})\n👉 [🔨 แบน IP นี้ 24 ชั่วโมง](${banLink24Hr})`, inline: false }
        ],
        footer: { text: `Velvet Chat System • ${new Date().toLocaleString('th-TH')}` }
      }
    ]
  };

  fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (res.ok) console.log('✅ [Discord Webhook] ส่งรายงานสำเร็จ');
    else console.error('❌ [Discord Webhook Error] Status:', res.status);
  })
  .catch(err => console.error('❌ [Discord Webhook Fetch Error]:', err));
}

app.get('/admin/ban', (req, res) => {
  const { ip, key, duration } = req.query;

  if (key !== ADMIN_SECRET) return res.status(403).send('Unauthorized Key');
  if (!ip) return res.status(400).send('Missing IP Parameter');

  const banMins = duration ? parseInt(duration) : 60;
  const banDurationMs = banMins * 60 * 1000;
  bannedIPs.set(ip, Date.now() + banDurationMs);

  for (const [id, u] of users.entries()) {
    if (u.ip === ip) {
      u.socket.emit('cooldown', { ms: banDurationMs });
      u.socket.disconnect(true);
    }
  }

  res.send(`<h1>✅ สั่งแบนสำเร็จ!</h1><p>IP: <b>${ip}</b> ถูกแบนเรียบร้อยแล้วเป็นเวลา ${banMins} นาที</p>`);
});

const broadcastOnline = () => io.emit('online', users.size);

io.on('connection', (socket) => {
  const clientIP = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address;

  if (bannedIPs.has(clientIP)) {
    const banUntil = bannedIPs.get(clientIP);
    if (Date.now() < banUntil) {
      socket.emit('cooldown', { ms: banUntil - Date.now() });
      socket.disconnect(true);
      return;
    } else {
      bannedIPs.delete(clientIP);
    }
  }

  const u = newUser(socket, clientIP);
  users.set(socket.id, u);
  socket.emit('hello', { nick: u.nick, emoji: u.emoji });
  broadcastOnline();

  socket.on('sit', () => {
    if (u.state !== 'idle') return;
    const wait = u.banUntil - Date.now();
    if (wait > 0) return socket.emit('cooldown', { ms: wait });
    enqueue(u);
  });

  socket.on('leave', () => {
    if (u.state === 'seated') {
      closeTable(tables.get(u.tableId), 'leave', u.id);
    } else if (u.state === 'waiting') {
      dequeue(u.id);
      u.state = 'idle';
      socket.emit('ended', { reason: 'leave', self: true });
    }
  });

  socket.on('update-profile', (profile) => {
    if (profile && typeof profile === 'object') {
      u.status = typeof profile.status === 'string' ? profile.status.trim().slice(0, 30) : '🌧️ เหงา';
      u.music = typeof profile.music === 'string' ? profile.music.trim().slice(0, 300) : '';
      otherOf(u)?.socket.emit('partner-profile-changed', { status: u.status, music: u.music });
    }
  });

  socket.on('msg', (text, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (u.state !== 'seated' || typeof text !== 'string') return reply({ err: 'state' });
    const now = Date.now();
    if (now - u.lastMsg < MIN_GAP_MS) return reply({ err: 'rate' });
    const clean = text.trim().slice(0, MAX_LEN);
    if (!clean) return reply({ err: 'empty' });

    const bad = check(clean);
    if (bad) {
      u.strikes = u.strikes.filter((x) => now - x < STRIKE_WINDOW_MS);
      u.strikes.push(now);
      reply({ err: 'filtered', cat: bad.cat, strikes: u.strikes.length, max: MAX_STRIKES });
      if (u.strikes.length >= MAX_STRIKES) {
        u.strikes = [];
        u.banUntil = now + COOLDOWN_MS;
        closeTable(tables.get(u.tableId), 'violations', u.id);
      }
      return;
    }

    const t = tables.get(u.tableId);
    if (t) {
      t.lastInteraction = now;
      t.isSpeedUp = false;
      if (!t.logs) t.logs = [];
      t.logs.push({ sender: `${u.emoji} ${u.nick}`, text: clean });
      if (t.logs.length > 10) t.logs.shift();
    }

    u.lastMsg = now;
    u.seq += 1;
    reply({ seq: u.seq });
    otherOf(u)?.socket.emit('msg', { seq: u.seq, text: clean, ts: now });
  });

  socket.on('typing', (on) => {
    if (u.state !== 'seated') return;
    otherOf(u)?.socket.emit('typing', !!on);
  });

  socket.on('report', (data) => {
    if (u.state === 'seated' && tables.has(u.tableId)) {
      const t = tables.get(u.tableId);
      const targetUser = users.get(t.a === u.id ? t.b : t.a);

      if (targetUser) {
        sendDiscordReport({
          reporter: { nick: u.nick, emoji: u.emoji, ip: u.ip },
          target: { nick: targetUser.nick, emoji: targetUser.emoji, ip: targetUser.ip },
          reason: (data && data.reason) ? data.reason : 'พฤติกรรมไม่เหมาะสม/พิมพ์คำไม่สุภาพ',
          logs: t.logs || []
        });

        targetUser.reportCount = (targetUser.reportCount || 0) + 1;
        if (targetUser.reportCount >= 3) {
          bannedIPs.set(targetUser.ip, Date.now() + (15 * 60 * 1000));
        }
      }

      closeTable(t, 'report', u.id);
    }
  });

  socket.on('vote-extend', (agree) => {
    if (u.state !== 'seated') return;
    const t = tables.get(u.tableId);
    if (!t) return;

    t.extendVotes.set(u.id, agree);

    if (!agree) {
      closeTable(t, 'time-up-new-match');
    } else if (t.extendVotes.size === 2 && Array.from(t.extendVotes.values()).every(v => v === true)) {
      t.remainingMs = TABLE_MS;
      t.lastInteraction = Date.now();
      t.extendVotes.clear();
      t.timer = setInterval(() => updateTableTimer(t), 1000);

      io.to(t.a).emit('time-extended');
      io.to(t.b).emit('time-extended');
    }
  });

  socket.on('disconnect', () => {
    if (u.state === 'seated' && tables.has(u.tableId)) {
      closeTable(tables.get(u.tableId), 'partner-left', u.id);
    }
    dequeue(u.id);
    users.delete(u.id);
    broadcastOnline();
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
