'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const fs = require('fs');
const { generateSentence } = require('../services/dailySentence');
const { sendEmailWithTemplate } = require('../services/tencentSes');

function loadSubscribers() {
    const file = path.join(process.cwd(), 'data', 'subscribers.json');
    if (!fs.existsSync(file)) return { subscribers: [] };
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { subscribers: [] }; }
}

(async function main() {
    const source = process.env.SOURCE_LANGUAGE || 'english';
    const { subscribers } = loadSubscribers();
    const active = subscribers.filter(s => s.isSubscribed);
    if (active.length === 0) {
        console.log('No subscribers.');
        return;
    }
    // Filter out expired subscriptions
    const now = Date.now();
    const valid = active.filter(s => !s.expiresAt || s.expiresAt > now);
    const grouped = valid.reduce((acc, s) => {
        const lang = s.language || 'japanese';
        const lvl = s.level || 'N3';
        const key = lang + '|' + lvl;
        (acc[key] ||= { language: lang, level: lvl, users: [] }).users.push(s);
        return acc;
    }, {});
    let sent = 0;
    for (const { language, level, users } of Object.values(grouped)) {
        const sentence = await generateSentence(source, language, level);
        const templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${language === 'english' ? '_EN' : ''}`] || (language === 'english' ? 65687 : 65685));
        const subject = `${language === 'english' ? '今日の英語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
        for (const u of users) {
            const ok = await sendEmailWithTemplate(u.email, templateId, sentence, subject);
            if (ok) sent += 1;
        }
    }
    console.log('Sent:', sent);
})().catch(e => { console.error(e); process.exit(1); });


