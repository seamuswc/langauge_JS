'use strict'

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// NOTE: Tencent SES has an AWS SES-compatible API in some regions. If you're using Tencent's SDK specifically,
// swap this module for their official Node SDK. For simplicity, we assume AWS-compatible endpoint via env.

function getSesClient() {
    const region = process.env.TENCENT_SES_REGION || 'ap-hongkong';
    const endpoint = process.env.TENCENT_SES_ENDPOINT; // optional override
    const credentials = {
        accessKeyId: process.env.TENCENT_SECRET_ID || '',
        secretAccessKey: process.env.TENCENT_SECRET_KEY || ''
    };
    const cfg = { region, credentials };
    if (endpoint) cfg.endpoint = endpoint;
    return new SESClient(cfg);
}

function processTemplateData(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
        if ((k === 'breakdown' || k === 'grammar') && typeof v === 'string') {
            out[k] = v.replace(/\n/g, '<br>');
        } else {
            out[k] = v;
        }
    }
    return out;
}

async function sendEmailWithTemplate(to, templateId, templateData, subject) {
    const from = process.env.TENCENT_SES_SENDER;
    if (!from) throw new Error('TENCENT_SES_SENDER not set');
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Invalid recipient email');

    // Many SES providers use string template names. If your Tencent account requires numeric TemplateID,
    // you may need to call their native API instead. Here we inline a simple HTML using the data.
    const data = processTemplateData(templateData);
    const html = `
      <div>
        ${data.kanji ? `<p><strong>漢字:</strong> ${data.kanji}</p>` : ''}
        ${data.hiragana ? `<p><strong>ひらがな:</strong> ${data.hiragana}</p>` : ''}
        ${data.romaji ? `<p><strong>Romaji:</strong> ${data.romaji}</p>` : ''}
        ${data.breakdown ? `<p><strong>Breakdown:</strong><br>${data.breakdown}</p>` : ''}
        ${data.grammar ? `<p><strong>Grammar:</strong><br>${data.grammar}</p>` : ''}
        ${data.meaning ? `<p><strong>Meaning:</strong> ${data.meaning}</p>` : ''}
      </div>`;

    const text = [
        data.kanji && `Kanji: ${data.kanji}`,
        data.hiragana && `Hiragana: ${data.hiragana}`,
        data.romaji && `Romaji: ${data.romaji}`,
        data.breakdown && `Breakdown:\n${data.breakdown.replace(/<br>/g, '\n')}`,
        data.grammar && `Grammar:\n${data.grammar.replace(/<br>/g, '\n')}`,
        data.meaning && `Meaning: ${data.meaning}`
    ].filter(Boolean).join('\n');

    const client = getSesClient();
    const cmd = new SendEmailCommand({
        Destination: { ToAddresses: [to] },
        Source: from,
        Message: {
            Subject: { Data: subject || 'Daily Sentence' },
            Body: {
                Html: { Data: html },
                Text: { Data: text }
            }
        }
    });
    try {
        await client.send(cmd);
        return true;
    } catch (e) {
        console.error('SES send failed', e);
        return false;
    }
}

module.exports = { sendEmailWithTemplate };


