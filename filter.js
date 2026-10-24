// filter.js - ระบบกรองคำหยาบและข้อมูลต้องห้าม (TH + EN + KARAOKE)
const BAD_WORDS = [
  // --- ภาษาไทย (คำทั่วไป / คำเลียนเสียง / คำเขียนหลบ) ---
  'ควย', 'ค*ย', 'ค_ย', 'ควยย', 'ควยไร', 'หัวควย',
  'เย็ด', 'เย็*', 'เย้ด', 'เยด', 'เย็ดแม่', 'เย็ดแม่ง',
  'มึง', 'มึ_ง', 'มึงง',
  'กู', 'กูู',
  'เหี้ย', 'เหี๊ยะ', 'เหี้ยย', 'เฮี้ย', 'ห้ะเหี้ย', 'เหี้ยไร',
  'สัส', 'สัตว์', 'สั_ส', 'ส้ส', 'สาส', 'สัสเอ๊ย', 'ไอ้สัตว์', 'ไอสัตว์',
  'เงี่ยน', 'เงี่_ยน',
  'หี', 'ห*ี', 'หน้าหี', 'แตด', 'คก', 'ตอแหล', 'Eหี', 'อีหี',
  'กระหรี่', 'กะหรี่', 'ชิปหาย', 'ฉิบหาย', 'เชี่ย', 'กาก',
  'พ่อง', 'พ่อมึง', 'ควาย', 'ไอควาย', 'ไอ้ควาย', 'ออีควาย', 'ไควย',

  // --- ภาษาไทยคาราโอเกะ / คำอ่านเลียนเสียง (Transliterated) ---
  'kuy', 'kuay', 'kwai', 'huakuy', 'hua kuy', 'hua kuay', 'kuyy',
  'hee', 'heee', 'nahee', 'na hee', 'nahhee',
  'yed', 'yedd', 'yedmae', 'yed ma', 'y3d',
  'moong', 'meung', 'mung', 'meungg',
  'goo', 'guu',
  'hia', 'heaa', 'here', 'heere', 'herey',
  'sat', 'sard', 'sadd', 'sus', 'suss',
  'ngian', 'ngean',
  'kak', 'kakk', 'gark',

  // --- ภาษาอังกฤษ (Profanity / Vulgarities) ---
  'fuck', 'f*ck', 'fuk', 'fck', 'fucking', 'fuckin',
  'shit', 'sh*t', 'shite',
  'bitch', 'b*tch', 'biiiitch',
  'bastard',
  'dick', 'd*ck',
  'pussy', 'p*ssy',
  'cunt', 'c*nt',
  'ass', 'asshole', 'a**hole',
  'motherfucker', 'mf', 'mofo',
  'cock', 'c*ck',
  'slut', 'whore',
  'boobs', 'vagina', 'penis',
  'wtf', 'stfu'
];

function check(text) {
  if (!text || typeof text !== 'string') return null;

  const lowerText = text.toLowerCase();
  const normalizedText = lowerText.replace(/\s+/g, '');

  for (const word of BAD_WORDS) {
    const targetWord = word.toLowerCase();
    if (lowerText.includes(targetWord) || normalizedText.includes(targetWord.replace(/\s+/g, ''))) {
      return { cat: 'profanity' };
    }
  }
  return null;
}

module.exports = { check };
