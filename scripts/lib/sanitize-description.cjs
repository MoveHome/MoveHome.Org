"use strict";

// Mirror of src/lib/sanitize-description.ts for CommonJS scripts. Keep in sync.

const CONTACT_URL_RE =
  /(?:https?:\/\/|www\.)[^\s<>()"']+|(?<![\w.])(?:bit\.ly|wa\.me|line\.me|t\.me|linktr\.ee)\/[^\s<>()"']+/gi;

const PHONE_RE = /(?<![\w£$])\+?\d[\d\s().-]{7,}\d(?![\w])/g;

const LEADING_BULLET_RE =
  /^[\s•·▪◦●○◆◇■□➤➢►▶️✔✅⭐\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]+/u;

const DANGLING_CONTACT_PREFIX_RE =
  /^(?:contact(?:\s+us)?|call(?:\s+us)?|tel|phone|whatsapp|line|wechat|telegram|or|\s)*[:：\-–—]?$/i;

function sanitizeDescription(input) {
  if (input == null) return "";

  const lines = String(input).replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  for (const raw of lines) {
    let line = raw.replace(LEADING_BULLET_RE, "");
    let removedContact = false;

    line = line.replace(CONTACT_URL_RE, () => {
      removedContact = true;
      return "";
    });

    line = line.replace(PHONE_RE, (match) => {
      if (match.replace(/\D/g, "").length < 9) return match;
      removedContact = true;
      return "";
    });

    line = line.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+|[ \t]+$/g, "");

    if (removedContact && DANGLING_CONTACT_PREFIX_RE.test(line)) {
      line = "";
    }

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { sanitizeDescription };
