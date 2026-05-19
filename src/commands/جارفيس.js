const { getOrCreateUser, User, CommandLog } = require("../utils/database");
const { screenshotProfile } = require("../utils/screenshotter");
const fs   = require("fs-extra");
const path = require("path");

const REPORT_TYPES = {
  شتم:      { emoji: "🤬", label: "شتم وألفاظ مسيئة",     fbCategory: "harassment" },
  إهانة:    { emoji: "😡", label: "إهانة شخصية",           fbCategory: "harassment" },
  تحرش:     { emoji: "🔴", label: "تحرش وإزعاج",           fbCategory: "harassment" },
  بوت:      { emoji: "⚙️", label: "استخدام Userbot",        fbCategory: "spam" },
  userbot:  { emoji: "⚙️", label: "استخدام Userbot",        fbCategory: "spam" },
  سبام:     { emoji: "📵", label: "رسائل مزعجة (Spam)",     fbCategory: "spam" },
  spam:     { emoji: "📵", label: "رسائل مزعجة (Spam)",     fbCategory: "spam" },
  محتوى:    { emoji: "🚫", label: "محتوى غير لائق",         fbCategory: "inappropriate" },
  تهديد:    { emoji: "⛔", label: "تهديدات صريحة",          fbCategory: "violence" },
  انتحال:   { emoji: "🎭", label: "انتحال شخصية",           fbCategory: "impersonation" },
  خصوصية:  { emoji: "🔒", label: "انتهاك الخصوصية",        fbCategory: "privacy" },
  default:  { emoji: "⚠️", label: "مخالفة عامة",            fbCategory: "other" },
};

const FB_REPORT_LINKS = {
  harassment:    "https://www.facebook.com/help/contact/274459462613911",
  spam:          "https://www.facebook.com/help/contact/628195490920576",
  inappropriate: "https://www.facebook.com/help/contact/461169580556043",
  violence:      "https://www.facebook.com/help/contact/305410456169423",
  impersonation: "https://www.facebook.com/help/contact/295309487309948",
  privacy:       "https://www.facebook.com/help/contact/144059062408922",
  other:         "https://www.facebook.com/help/contact/274459462613911",
};

const REPORT_GUIDE = (targetID, targetName, type) => {
  const info = REPORT_TYPES[type] || REPORT_TYPES.default;
  const profileUrl = `https://www.facebook.com/profile.php?id=${targetID}`;
  const reportUrl  = FB_REPORT_LINKS[info.fbCategory];
  return `
📋 دليل إرسال البلاغ لفيسبوك:
━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ افتح الملف الشخصي:
   ${profileUrl}

2️⃣ انقر على النقاط الثلاث (...) أعلى الصفحة
   ثم اختر "الإبلاغ عن الملف الشخصي"

3️⃣ أو استخدم رابط البلاغ المباشر:
   ${reportUrl}

4️⃣ اختر سبب البلاغ:
   ${info.emoji} ${info.label}

5️⃣ أرفق السكرينشوتات المرسلة كدليل
━━━━━━━━━━━━━━━━━━━━━━━━
🆔 معرّف المنتهك: ${targetID}
👤 الاسم: ${targetName}
`.trim();
};

async function getUserInfo(api, userID) {
  return new Promise((resolve) => {
    api.getUserInfo([userID], (err, data) => {
      if (err || !data || !data[userID]) return resolve({ name: "مستخدم غير معروف", profileUrl: null });
      const u = data[userID];
      resolve({
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || "مستخدم",
        profileUrl: u.profileUrl || null,
        thumbSrc: u.thumbSrc || null,
      });
    });
  });
}

async function getPastViolations(targetID) {
  try {
    const user = await User.findOne({ where: { userID: String(targetID) } });
    const logs = await CommandLog.findAll({
      where: { userID: String(targetID) },
      order: [["createdAt", "DESC"]],
      limit: 10,
    });
    return {
      warnings: user?.warnings || 0,
      banned:   user?.banned   || false,
      logs:     logs.map(l => `• ${l.command} — ${new Date(l.createdAt).toLocaleDateString("ar-DZ")}`),
    };
  } catch (_) {
    return { warnings: 0, banned: false, logs: [] };
  }
}

module.exports = {
  config: {
    name: "جارفيس",
    aliases: ["jarvis", "بلاغ", "تبليغ"],
    description: "رصد المنتهك وإرسال تقرير كامل للمالك في الخاص مع سكرينشوتات",
    usage: "جارفيس [نوع: شتم|إهانة|تحرش|بوت|سبام|محتوى|تهديد|انتحال|خصوصية]",
    adminOnly: true,
  },

  async run({ api, event, args, threadID, senderID }) {
    if (!global.isOwner?.(senderID) && !global.isAdmin?.(senderID)) {
      return api.sendMessage("⛔ هذا الأمر للمالك والمشرفين فقط.", threadID);
    }

    const replied = event.messageReply;
    if (!replied) {
      return api.sendMessage(
        "❌ الاستخدام: رد على رسالة المنتهك ثم اكتب:\n" +
        "/جارفيس [نوع المخالفة]\n\n" +
        "أنواع المخالفات:\nشتم | إهانة | تحرش | بوت | سبام | محتوى | تهديد | انتحال | خصوصية",
        threadID
      );
    }

    const targetID    = replied.senderID;
    const violType    = args[0] || "default";
    const typeInfo    = REPORT_TYPES[violType] || REPORT_TYPES.default;
    const ownerID     = global.ownerID || (global.botConfig || {}).ownerID;

    api.sendMessage("🔍 جاري رصد المنتهك وجمع الأدلة...", threadID);

    const [userInfo, history] = await Promise.all([
      getUserInfo(api, targetID),
      getPastViolations(targetID),
    ]);

    const { name: targetName } = userInfo;

    try {
      const user = await getOrCreateUser(targetID, targetName);
      await user.update({ warnings: (user.warnings || 0) + 1 });
    } catch (_) {}

    const reportText = `
${typeInfo.emoji} تقرير مخالفة — ${typeInfo.label}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 المنتهك: ${targetName}
🆔 المعرّف: ${targetID}
💬 الرسالة المخالفة:
"${replied.body || "[محتوى غير نصي]"}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 سجل المخالفات السابقة:
• إجمالي التحذيرات: ${history.warnings + 1}
• الحالة: ${history.banned ? "محظور ✋" : "نشط 🟢"}
${history.logs.length ? "• آخر نشاط:\n" + history.logs.slice(0,5).join("\n") : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${REPORT_GUIDE(targetID, targetName, violType)}
`.trim();

    if (ownerID) {
      api.sendMessage(reportText, ownerID);
    }
    api.sendMessage(reportText, senderID);

    const appState = global.api?.ctx?.jar?.toJSON?.()?.cookies ||
                     global._appState || [];

    if (appState.length) {
      api.sendMessage("📸 جاري التقاط سكرينشوتات للملف الشخصي...", senderID);

      screenshotProfile(targetID, appState)
        .then(async ({ profile, timeline, error }) => {
          if (error) {
            api.sendMessage(`⚠️ تعذّر التقاط السكرينشوت: ${error}`, senderID);
            return;
          }

          const send = (filePath, caption) => {
            if (!filePath || !fs.existsSync(filePath)) return;
            api.sendMessage(
              { body: caption, attachment: fs.createReadStream(filePath) },
              senderID,
              () => { try { fs.unlinkSync(filePath); } catch (_) {} }
            );
            if (ownerID && ownerID !== senderID) {
              api.sendMessage(
                { body: caption, attachment: fs.createReadStream(filePath) },
                ownerID
              );
            }
          };

          send(profile,  `📌 الملف الشخصي — ${targetName} (${targetID})`);
          setTimeout(() => send(timeline, `📜 الجدول الزمني — ${targetName}`), 2000);
        })
        .catch(err => api.sendMessage(`⚠️ خطأ في السكرينشوت: ${err.message}`, senderID));
    } else {
      api.sendMessage(
        "ℹ️ السكرينشوتات غير متاحة (الكوكيز غير محمّلة بعد).\n" +
        `🔗 افتح الملف الشخصي: https://www.facebook.com/profile.php?id=${targetID}`,
        senderID
      );
    }

    api.sendMessage(
      `✅ تم توثيق المخالفة وإرسال التقرير.\n👤 ${targetName} | 🆔 ${targetID}\n📋 ${typeInfo.emoji} ${typeInfo.label}`,
      threadID,
      (err, info) => {
        if (!err && info?.messageID) {
          setTimeout(() => api.unsendMessage(info.messageID), 12000);
        }
      }
    );
  },
};
