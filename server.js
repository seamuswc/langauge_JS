'use strict'

require('dotenv').config();

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const fastifyStatic = require('@fastify/static');
const path = require('path');
const fs = require('fs');
const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair } = require('@solana/web3.js');
const { generateSentence } = require('./services/dailySentence');
const { sendEmailWithTemplate } = require('./services/tencentSes');
const DEFAULT_RECIPIENT = '8zS5w8MHSDQ4Pc12DZRLYQ78hgEwnBemVJMrfjUN6xXj';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const HOST = process.env.HOST || '0.0.0.0';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function ata(owner, mint) {
	return PublicKey.findProgramAddressSync(
		[owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
		ASSOCIATED_TOKEN_PROGRAM_ID
	)[0];
}

function u64ToLeBytes(v) {
	const out = new Uint8Array(8);
	let n = BigInt(v);
	for (let i = 0; i < 8; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
	return out;
}

function ixCreateIdempotentATA(payer, ataPk, owner, mint) {
	return new TransactionInstruction({
		programId: ASSOCIATED_TOKEN_PROGRAM_ID,
		keys: [
			{ pubkey: payer, isSigner: true, isWritable: true },
			{ pubkey: ataPk, isSigner: false, isWritable: true },
			{ pubkey: owner, isSigner: false, isWritable: false },
			{ pubkey: mint, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
		],
		data: new Uint8Array([1]) // CreateIdempotent
	});
}

function ixTransferChecked(src, mint, dst, owner, amountUnits, decimals, ref) {
	const data = new Uint8Array(1 + 8 + 1);
	data[0] = 12; // TransferChecked
	data.set(u64ToLeBytes(amountUnits), 1);
	data[9] = decimals;
	const keys = [
		{ pubkey: src, isSigner: false, isWritable: true },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{ pubkey: dst, isSigner: false, isWritable: true },
		{ pubkey: owner, isSigner: true, isWritable: false },
	];
	if (ref) keys.push({ pubkey: ref, isSigner: false, isWritable: false });
	return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys, data });
}

async function buildUsdcTransferTx({ payer, recipient, amount, reference }) {
	const payerPk = new PublicKey(payer);
	const recipientPk = new PublicKey(recipient);
	const refPk = reference ? new PublicKey(reference) : undefined;

	const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
	const { blockhash } = await connection.getLatestBlockhash({ commitment: 'processed' });

	const payerAta = ata(payerPk, USDC_MINT);
	const recipientAta = ata(recipientPk, USDC_MINT);

	const tx = new Transaction({ feePayer: payerPk, recentBlockhash: blockhash });
	tx.add(ixCreateIdempotentATA(payerPk, recipientAta, recipientPk, USDC_MINT));

	const units = BigInt(Math.round(Number(amount) * 1_000_000)); // 6 decimals
	tx.add(ixTransferChecked(payerAta, USDC_MINT, recipientAta, payerPk, units, 6, refPk));

	return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

async function main() {
	const app = Fastify({ logger: true });
	await app.register(cors, { origin: true });
	await app.register(fastifyStatic, { root: path.join(__dirname, 'public'), index: ['index.html'] });

	// Public config for frontend
	app.get('/api/config', async () => ({
		recipient: process.env.SOLANA_MERCHANT_ADDRESS || DEFAULT_RECIPIENT,
		usdcMint: USDC_MINT.toBase58(),
		aptosRecipient: process.env.APTOS_MERCHANT_ADDRESS || '',
		defaultAmount: 2
	}));

	// Simple JSON store for orders
	const dataDir = path.join(__dirname, 'data');
	const ordersFile = path.join(dataDir, 'orders.json');
	const subscribersFile = path.join(dataDir, 'subscribers.json');
	if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
	if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, JSON.stringify({ orders: [] }, null, 2));
	if (!fs.existsSync(subscribersFile)) fs.writeFileSync(subscribersFile, JSON.stringify({ subscribers: [] }, null, 2));

	function writeFileAtomic(filePath, dataObj) {
		const dir = path.dirname(filePath);
		const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
		fs.writeFileSync(tmp, JSON.stringify(dataObj, null, 2));
		fs.renameSync(tmp, filePath);
	}

	function loadOrders() {
		try { return JSON.parse(fs.readFileSync(ordersFile, 'utf8')); } catch { return { orders: [] }; }
	}

	function saveOrders(data) { writeFileAtomic(ordersFile, data); }

	function loadSubscribers() {
		try { return JSON.parse(fs.readFileSync(subscribersFile, 'utf8')); } catch { return { subscribers: [] }; }
	}

	function saveSubscribers(data) { writeFileAtomic(subscribersFile, data); }

	function normalizeEmail(email) {
		return String(email || '').trim().toLowerCase();
	}

	function isValidEmail(email) {
		return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
	}

	app.get('/health', async () => ({ ok: true }));

	// Daily sentence (DeepSeek-backed)
	app.get('/api/daily-sentence', async (req, reply) => {
		try {
			const source = (req.query.source || process.env.SOURCE_LANGUAGE || 'english').toString();
			const target = (req.query.target || process.env.TARGET_LANGUAGE || 'japanese').toString();
			const result = await generateSentence(source, target);
			const text = [
				result.kanji ? `漢字: ${result.kanji}` : null,
				result.hiragana ? `ひらがな: ${result.hiragana}` : null,
				result.romaji ? `Romaji: ${result.romaji}` : null,
				result.breakdown ? `Breakdown:\n${result.breakdown}` : null,
				result.grammar ? `Grammar:\n${result.grammar}` : null,
				result.meaning ? `Meaning: ${result.meaning}` : null
			].filter(Boolean).join('\n');
			return { ...result, text };
		} catch (e) {
			reply.code(500);
			return { error: e.message || String(e) };
		}
	});

	// Subscribe to daily emails
	app.post('/api/subscribe', async (req, reply) => {
		try {
			const { email, language } = req.body || {};
			if (!email || typeof email !== 'string') return reply.code(400).send({ error: 'email required' });
			const lang = (language || process.env.TARGET_LANGUAGE || 'japanese').toString();
			const store = loadSubscribers();
			const existing = store.subscribers.find(s => s.email.toLowerCase() === email.toLowerCase());
			if (existing) {
				existing.language = lang;
				existing.isSubscribed = true;
				existing.updatedAt = Date.now();
			} else {
				store.subscribers.push({ email, language: lang, isSubscribed: true, createdAt: Date.now(), updatedAt: Date.now() });
			}
			saveSubscribers(store);
			return { ok: true };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Unsubscribe
	app.post('/api/unsubscribe', async (req, reply) => {
		try {
			const { email } = req.body || {};
			if (!email || typeof email !== 'string') return reply.code(400).send({ error: 'email required' });
			const store = loadSubscribers();
			const existing = store.subscribers.find(s => s.email.toLowerCase() === email.toLowerCase());
			if (existing) {
				existing.isSubscribed = false;
				existing.updatedAt = Date.now();
				saveSubscribers(store);
			}
			return { ok: true };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Admin: send daily (manual trigger)
	app.post('/api/admin/send-daily', async (req, reply) => {
		try {
			const store = loadSubscribers();
			const subs = store.subscribers.filter(s => s.isSubscribed);
			if (subs.length === 0) return { sent: 0 };
			const source = process.env.SOURCE_LANGUAGE || 'english';
			const byLang = subs.reduce((acc, s) => { (acc[s.language] ||= []).push(s); return acc; }, {});
			let total = 0;
			for (const [language, users] of Object.entries(byLang)) {
				const sentence = await generateSentence(source, language);
				const templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${language === 'english' ? '_EN' : ''}`] || (language === 'english' ? 65687 : 65685));
				const subject = `${language === 'english' ? '今日の英語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
				const templateData = sentence;
				for (const u of users) {
					const ok = await sendEmailWithTemplate(u.email, templateId, templateData, subject);
					if (ok) total += 1;
				}
			}
			return { sent: total };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Create a new order and server-generated reference
	app.post('/api/subscribe/start', async (req, reply) => {
		try {
			const { email, plan, language } = req.body || {};
			const normEmail = normalizeEmail(email);
			if (!isValidEmail(normEmail)) return reply.code(400).send({ error: 'valid email required' });
			const planKey = (plan || 'month').toString();
			const PLANS = { month: 2, year: 12 };
			if (!PLANS[planKey]) return reply.code(400).send({ error: 'invalid plan' });
			const ref = Keypair.generate().publicKey.toBase58();
			const orderId = 'ord_' + Math.random().toString(36).slice(2, 10);
			const store = loadOrders();
			store.orders.push({ orderId, reference: ref, status: 'pending', createdAt: Date.now(), email: normEmail, plan: planKey, amount: PLANS[planKey], language: (language || process.env.TARGET_LANGUAGE || 'japanese').toString() });
			saveOrders(store);
			return { orderId, reference: ref, amount: PLANS[planKey] };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	app.post('/tx/usdc', async (req, reply) => {
		try {
			const { payer, recipient, amount, reference } = req.body || {};
			if (!payer || !recipient || !amount) {
				return reply.code(400).send({ error: 'Missing payer, recipient, or amount' });
			}
			const txb64 = await buildUsdcTransferTx({ payer, recipient, amount, reference });
			return { transaction: txb64 };
		} catch (e) {
			req.log.error(e);
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Basic payment check by reference address. Also finalize subscription if paid
	app.get('/api/payments/status', async (req, reply) => {
		try {
			const reference = req.query.reference;
			if (!reference) return reply.code(400).send({ error: 'reference required' });
			const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
			const sigs = await connection.getSignaturesForAddress(new PublicKey(reference), { limit: 1 });
			const found = sigs && sigs.length > 0 ? sigs[0] : null;
			const paid = !!found;

			let updated = false;
			if (paid) {
				const store = loadOrders();
				const order = store.orders.find(o => o.reference === reference);
				if (order && order.status !== 'paid') {
					order.status = 'paid';
					order.paidAt = Date.now();
					saveOrders(store);
					const subStore = loadSubscribers();
					const idx = subStore.subscribers.findIndex(s => normalizeEmail(s.email) === normalizeEmail(order.email));
					const now = Date.now();
					const durationMs = order.plan === 'year' ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
					if (idx >= 0) {
						const current = subStore.subscribers[idx];
						const base = current.expiresAt && current.expiresAt > now ? current.expiresAt : now;
						const newExpires = base + durationMs;
						current.isSubscribed = true;
						current.expiresAt = newExpires;
						current.language = order.language || current.language;
						current.updatedAt = now;
					} else {
						const expiresAt = now + durationMs;
						subStore.subscribers.push({ email: order.email, language: order.language, isSubscribed: true, createdAt: now, updatedAt: now, expiresAt });
					}
					saveSubscribers(subStore);
					updated = true;
				}
			}
			return { paid, signature: found ? found.signature : null, updated };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	await app.listen({ host: HOST, port: PORT });
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});


