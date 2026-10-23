// filter.js - ระบบกรองคำหยาบและข้อมูลต้องห้าม
const BAD_WORDS = ['ควย', 'เย็ด', 'มึง', 'กู', 'เหี้ย', 'สัส', 'เงี่ยน'];

function check(text) {
  for (const word of BAD_WORDS) {
    if (text.includes(word)) {
      return { cat: 'profanity' };
    }
  }
  return null;
}

module.exports = { check };
