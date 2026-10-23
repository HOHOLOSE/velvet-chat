// server.js - Velvet Chat Server (Node.js + Socket.io)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { check } = require('./filter');

const PORT = process.env.PORT || 3000;
const TABLE_MS = 10 * 60 * 1000;    // เวลาต่อโต๊ะ (10 นาที)[cite: 2]
const REMATCH_AFTER_MS = 15 * 1000; // รอนานเกินนี้ถึงยอมให้เจอคนเดิมซ้ำ[cite: 2]
const MAX_LEN = 500;
const MIN_GAP_MS = 400;             // กันส่งข้อความรัวเกินไป[cite: 2]
const MAX_STRIKES = 3;              // ส่งข้อความต้องห้ามครบ 3 ครั้ง = พักการใช้งาน[cite: 2]
const STRIKE_WINDOW_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 2 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

const ANIMALS = [
  ['สุนัขซื่อสัตย์', '🐶'], ['สุนัขจอมซน', '🐶'],
  ['แมวส้มจอมซน', '🐱'], ['แมวดำเร้นลับ', '🐱'],
  ['หนูตัวจิ๋ว', '🐭'], ['หนูสายสปีด', '🐭'],
  ['กระต่ายดวงจันทร์', '🐰'], ['กระต่ายสายสปีด', '🐰'],
  ['จิ้งจอกเจ้าเล่ห์', '🦊'], ['จิ้งจอกเก้าหาง', '🦊'],
  ['หมีง่วงยามดึก', '🐻'], ['หมีใหญ่ใจดี', '🐻'],
  ['แพนด้าขอบตาดำ', '🐼'], ['แพนด้าจอมกินไผ่', '🐼'],
  ['โคอาลาสโลว์ไลฟ์', '🐨'], ['โคอาล่านอนอืด', '🐨'],

  // --- สัตว์ใหญ่ / สัตว์ล่าเหยื่อ ---
  ['เสือโคร่งหน้านิ่ง', '🐯'], ['เสือดาวสายลม', '🐯'],
  ['สิงโตเจ้าป่า', '🦁'], ['สิงโตแผงคอทอง', '🦁'],
  ['วัวอารมณ์ดี', '🐮'], ['วัวน้อยกินหญ้า', '🐮'],
  ['หมูชมพูอวบอ้วน', '🐷'], ['หมูจอมกินแหลก', '🐷'],
  ['ลิงจอมซน', '🐵'], ['ลิงป่วนห้องแชท', '🐵'],
  ['ม้าพยศสายสปีด', '🐴'], ['ม้าขาวทรงเสน่ห์', '🐴'],
  ['แกะปุยเมฆ', '🐑'], ['แกะนุ่มฟู', '🐑'],
  ['อูฐท่องทะเลทราย', '🐪'], ['อูฐนักอดทน', '🐪'],
  ['ยีราฟคอยาว', '🦒'], ['ยีราฟผู้มองการณ์ไกล', '🦒'],
  ['ช้างน้อยใจดี', '🐘'], ['ช้างทรงพลัง', '🐘'],
  ['แรดจอมนิ่ง', '🦏'], ['แรดจอมลุย', '🦏'],
  ['ม้าลายลายทาง', '🦓'], ['ม้าลายสายอินดี้', '🦓'],
  ['กวางน้อยในพงศา', '🦌'], ['กวางเขาเรืองแสง', '🦌'],
  ['จิงโจ้นักหมัดหนัก', '🦘'], ['จิงโจ้สายกระโดด', '🦘'],

  // --- สัตว์อุจจาระ / สัตว์อุจจาระปีก ---
  ['นกอินทรีตาคม', '🦅'], ['นกอินทรีจ้าวเวหา', '🦅'],
  ['เป็ดน้อยก๊าบๆ', '🦆'], ['เป็ดนักลอยน้ำ', '🦆'],
  ['หงส์สง่างาม', '🦢'], ['หงส์ขาวไร้ตำหนิ', '🦢'],
  ['นกฮูกผู้รอบรู้', '🦉'], ['นกฮูกท่องราตรี', '🦉'],
  ['ฟลามิงโกชมพู', '🦩'], ['ฟลามิงโกสายยืนเดียว', '🦩'],
  ['นกยูงรำแพน', '🦚'], ['นกยูงหลากสีสัน', '🦚'],
  ['นกแก้วช่างพูด', '🦜'], ['นกแก้วพูดมาก', '🦜'],
  ['เพนกวินชุดทักซิโด้', '🐧'], ['เพนกวินเดินเตาะแตะ', '🐧'],

  // --- สัตว์ครึ่งบกครึ่งน้ำ / เลื้อยคลาน ---
  ['กบนักกระโดด', '🐸'], ['กบร้องยามฝนตก', '🐸'],
  ['จระเข้นอนนิ่ง', '🐊'], ['จระเข้กรามเหล็ก', '🐊'],
  ['เต่าสโลว์ไลฟ์', '🐢'], ['เต่าอาวุโส', '🐢'],
  ['กิ้งก่าเปลี่ยนสี', '🦎'], ['กิ้งก่าพรางตัว', '🦎'],
  ['งูพิษเร้นลับ', '🐍'], ['งูอสรพิษลึกลับ', '🐍'],

  // --- สัตว์ใต้ท้องทะเล ---
  ['วาฬยักษ์ใจดี', '🐳'], ['วาฬดนตรีใต้ทะเล', '🐳'],
  ['โลมาแสนรู้', '🐬'], ['โลมาอารมณ์ดี', '🐬'],
  ['ฉลามนักล่า', '🦈'], ['ฉลามดุร้าย', '🦈'],
  ['ปลาว่ายทวนน้ำ', '🐟'], ['ปลาการ์ตูนตัวจิ๋ว', '🐟'],
  ['หมวดแปดหนวด', '🐙'], ['ปลาหมึกจอมพ่นหมึก', '🐙'],
  ['ปูหนีบจอมกวน', '🦀'], ['ปูก้ามใหญ่', '🦀'],
  ['กุ้งตัวใส', '🦐'], ['กุ้งดีดขัน', '🦐'],

  // --- แมลงน่ารัก / ตัวจิ๋ว ---
  ['ผีเสื้อโบยบิน', '🦋'], ['ผีเสื้อแสนสวย', '🦋'],
  ['ผึ้งน้อยขยัน', '🐝'], ['ผึ้งผลิตน้ำหวาน', '🐝'],
  ['เต่าทองนำโชค', '🐞'], ['เต่าทองตัวจิ๋ว', '🐞'],
  ['แมงมุมชักใย', '🕷️'], ['แมงมุมเร้นลับ', '🕷️']
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
    state: 'idle', tableId: null, since: 0, recent: null, lastMsg: 0, seq: 0,
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
    endsAt: Date.now() + TABLE_MS, extend: new Set(), timer: null,
  };
  t.timer = setTimeout(() => closeTable(t, 'time'), TABLE_MS);
  tables.set(t.id, t);
  for (const [me, other] of [[a, b], [b, a]]) {
    me.state = 'seated';
    me.tableId = t.id;
    me.seq = 0;
    me.socket.emit('seated', {
      partner: other.nick, emoji: other.emoji, ms: TABLE_MS, total: TABLE_MS,
    });
  }
}

function closeTable(t, reason, actorId) {
  if (!tables.has(t.id)) return;
  clearTimeout(t.timer);
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
    u.lastMsg = now;
    u.seq += 1;
    reply({ seq: u.seq });
    otherOf(u)?.socket.emit('msg', { seq: u.seq, text: clean, ts: now });
  });

  socket.on('read', (upto) => {
    if (u.state !== 'seated' || !Number.isInteger(upto) || upto < 1) return;
    otherOf(u)?.socket.emit('read', upto);
  });

  socket.on('typing', (on) => {
    if (u.state !== 'seated') return;
    otherOf(u)?.socket.emit('typing', !!on);
  });

  socket.on('extend', () => {
    if (u.state !== 'seated') return;
    const t = tables.get(u.tableId);
    t.extend.add(u.id);
    if (t.extend.size < 2) return;
    t.extend.clear();
    clearTimeout(t.timer);
    t.endsAt = Date.now() + TABLE_MS;
    t.timer = setTimeout(() => closeTable(t, 'time'), TABLE_MS);
    for (const id of [t.a, t.b]) users.get(id)?.socket.emit('extended', { ms: TABLE_MS });
  });

  socket.on('report', (reason) => {
    if (u.state !== 'seated') return;
    const other = otherOf(u);
    const line = JSON.stringify({
      at: new Date().toISOString(), reporter: u.nick, reported: other?.nick,
      reportedId: other?.id, reason: String(reason || '').slice(0, 100),
    });
    fs.appendFile(path.join(__dirname, 'reports.log'), line + '\n', () => {});
    closeTable(tables.get(u.tableId), 'report', u.id);
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
server.listen(PORT, () => console.log(`โต๊ะคุยรันอยู่ที่ http://localhost:${PORT}`));
