'use strict'

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sendEmailWithTemplate } = require('../services/tencentSes');

function parseArgs(argv) {
    let lang = 'j';
    let to = process.env.MAIL_TEST_TO || '';
    for (const a of argv.slice(2)) {
        if (a.startsWith('--lang=')) lang = a.slice(7).toLowerCase();
        else if (a.startsWith('--to=')) to = a.slice(5);
    }
    return { lang, to };
}

(async function main() {
    const { lang, to } = parseArgs(process.argv);
    if (!['j', 'e'].includes(lang)) {
        console.error('Usage: node scripts/testEmail.js --lang=j|e [--to=email]');
        process.exit(1);
    }
    if (!to) {
        console.log('No --to provided; set MAIL_TEST_TO in env or pass --to=you@example.com.');
        return;
    }

    let templateId, templateData, subject;
    if (lang === 'j') {
        templateId = Number(process.env.TENCENT_SES_TEMPLATE_ID || 65685);
        const sentence = {
            kanji: '今日は良い天気ですね。',
            hiragana: 'きょうは いい てんき ですね。',
            romaji: 'Kyō wa ii tenki desu ne.',
            breakdown: '今日 (kyō) - today\nは (wa) - topic marker\n良い (ii) - good\n天気 (tenki) - weather\nです (desu) - copula\nね (ne) - particle for agreement',
            grammar: '〜ですね is a common sentence-ending pattern used to seek agreement. です is the polite copula, and ね adds a sense of shared understanding.'
        };
        templateData = {
            kanji: sentence.kanji,
            hiragana: sentence.hiragana,
            romaji: sentence.romaji,
            breakdown: sentence.breakdown,
            grammar: sentence.grammar
        };
        subject = '今日の日本語 ' + new Date().toLocaleDateString('en-US');
    } else {
        templateId = Number(process.env.TENCENT_SES_TEMPLATE_ID_EN || 65687);
        const sentence = {
            english: 'It’s a beautiful day today.',
            katakana: 'イッツ・ア・ビューティフル・デイ・トゥデイ',
            pronunciation: 'Itsu a byūtifuru dei tsudei',
            breakdown: "It’s - it is\nbeautiful - 美しい (utsukushii)\nday - 日 (hi)\ntoday - 今日 (kyou)",
            grammar: '“It’s a …” is a common structure for describing something. The verb “is” is contracted to “’s”.'
        };
        templateData = {
            english: sentence.english,
            katakana: sentence.katakana,
            pronunciation: sentence.pronunciation,
            breakdown: sentence.breakdown,
            grammar: sentence.grammar
        };
        subject = '今日の英語 ' + new Date().toLocaleDateString('en-US');
    }

    try {
        const ok = await sendEmailWithTemplate(to, templateId, templateData, subject);
        if (ok) {
            console.log(`✅ Email sent successfully to ${to}!`);
        } else {
            console.error('❌ Failed to send email.');
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
        process.exit(1);
    }
})();


