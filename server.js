// server.js - Velvet Chat Server (AM Edition)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { check } = require('./filter');

const PORT = process.env.PORT || 3000;
const TABLE_MS = 10 * 60 * 1000;    // เวลาต่อโต๊ะ 10 นาที[cite: 2]
const IDLE_THRESHOLD_MS = 30 * 1000; // เงียบเกิน 30 วินาที ไหม้เร็วขึ้น 2 เท่า
const REMATCH_AFTER_MS = 15 * 1000; // 15 วินาทีถึงยอมให้สุ่มเจอคนเดิม[cite: 2]
const MAX_LEN = 500;
const MIN_GAP_MS = 400;             // กันส่งข้อความรัวเกินไป[cite: 2]
const MAX_STRIKES = 3;              // ส่งคำต้องห้ามครบ 3 ครั้ง = พักการใช้งาน[cite: 2]
const STRIKE_WINDOW_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

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
const MOODS = ['ใจดี', 'ง่วง', 'ขี้เล่น', 'เงียบ', 'อารมณ์ดี', 'ช่างคิด', 'ใจเย็น', 'ซน', 'ร่าเริง', 'อบอุ่น'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const users = new Map();  // socket.id -> user[cite: 2]
const tables = new Map(); // tableId -> table[cite: 2]
let queue = [];
let tableSeq = 0;

function newUser(socket) {
  const [animal, emoji] = pick(ANIMALS);
  return {
    id: socket.id, socket, emoji, nick: `${animal}${pick(MOODS)}`,
    status: '🟢 Available', music: '', state: 'idle', tableId: null, since: 0, recent: null, lastMsg: 0, seq: 0,
    strikes: [], banUntil: 0,
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
    extendVotes: new Map()
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
    enqueue(u); // สุ่มโต๊ะใหม่อัตโนมัติ[cite: 2]
  }
}

const broadcastOnline = () => io.emit('online', users.size);

io.on('connection', (socket) => {
  const u = newUser(socket);
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

  // อัปเดตการตั้งสถานะอิสระ และ URL เพลง real-time
  socket.on('update-profile', (profile) => {
    if (profile && typeof profile === 'object') {
      u.status = typeof profile.status === 'string' ? profile.status.trim().slice(0, 30) : '🟢 Available';
      u.music = typeof profile.music === 'string' ? profile.music.trim().slice(0, 200) : '';
      
      otherOf(u)?.socket.emit('partner-profile-changed', {
        status: u.status,
        music: u.music
      });
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

setInterval(tryMatch, 5000);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
