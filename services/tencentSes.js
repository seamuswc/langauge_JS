'use strict'

// Tencent Cloud SES official SDK
const tencentcloud = require('tencentcloud-sdk-nodejs');
const SesClient = tencentcloud.ses.v20201002.Client;

function getSesClient() {
    const region = process.env.TENCENT_SES_REGION || 'ap-hongkong';
    const secretId = process.env.TENCENT_SECRET_ID || '';
    const secretKey = process.env.TENCENT_SECRET_KEY || '';
    const endpoint = process.env.TENCENT_SES_ENDPOINT || 'ses.tencentcloudapi.com';
    return new SesClient({
        credential: { secretId, secretKey },
        region,
        profile: { httpProfile: { endpoint } }
    });
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
    const client = getSesClient();
    const data = processTemplateData(templateData);
    const params = {
        FromEmailAddress: from,
        Destination: [to],
        Template: {
            TemplateID: Number(templateId),
            TemplateData: JSON.stringify(data)
        },
        Subject: subject || undefined
    };
    try {
        await client.SendEmail(params);
        return true;
    } catch (e) {
        console.error('Tencent SES send failed', e);
        return false;
    }
}

async function sendSimpleEmail(to, subject, html, text) {
    const from = process.env.TENCENT_SES_SENDER;
    if (!from) throw new Error('TENCENT_SES_SENDER not set');
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Invalid recipient email');

    const client = getSesClient();
    const params = {
        FromEmailAddress: from,
        Destination: [to],
        Subject: subject || 'Notification',
        Simple: {
            Html: html ? { Content: html } : undefined,
            Text: text ? { Content: text } : undefined
        }
    };
    try {
        await client.SendEmail(params);
        return true;
    } catch (e) {
        console.error('Tencent SES send failed', e);
        return false;
    }
}

module.exports = { sendEmailWithTemplate, sendSimpleEmail };


