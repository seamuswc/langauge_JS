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

const SUI_RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io';
const APTOS_RPC_URL = process.env.APTOS_RPC_URL || 'https://fullnode.mainnet.aptoslabs.com';

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
	await app.register(fastifyStatic, { root: path.join(__dirname, 'react-ui', 'dist'), index: ['index.html'] });

	// Public config for frontend
	app.get('/api/config', async () => ({
		recipient: process.env.SOLANA_MERCHANT_ADDRESS || DEFAULT_RECIPIENT,
		usdcMint: USDC_MINT.toBase58(),
		defaultAmount: 2,
		sui: {
			merchant: process.env.SUI_MERCHANT_ADDRESS || '',
			usdcCoinType: process.env.SUI_USDC_COIN_TYPE || ''
		},
		aptos: {
			merchant: process.env.APTOS_MERCHANT_ADDRESS || '',
			usdcCoinType: process.env.APTOS_USDC_COIN_TYPE || ''
		}
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
		try {
			fs.writeFileSync(tmp, JSON.stringify(dataObj, null, 2));
			fs.renameSync(tmp, filePath);
		} catch (error) {
			// Clean up temp file if it exists
			try {
				if (fs.existsSync(tmp)) {
					fs.unlinkSync(tmp);
				}
			} catch (cleanupError) {
				console.error('Failed to cleanup temp file:', cleanupError);
			}
			throw error;
		}
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
			const qTarget = (req.query.target || process.env.TARGET_LANGUAGE || 'japanese').toString();
			const target = qTarget;
			const source = (req.query.source || (target === 'english' ? 'japanese' : 'english') || process.env.SOURCE_LANGUAGE || 'english').toString();
			const level = (req.query.level || 'N3').toString();
			const result = await generateSentence(source, target, level);
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
				const subject = `${language === 'english' ? '今日の英語' : language === 'thai' ? '今日のタイ語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
				const templateData = sentence;
				for (const u of users) {
					// Choose template based on user's native language for Thai
					let templateId;
					if (language === 'thai') {
						templateId = Number(process.env.TENCENT_SES_TEMPLATE_ID_TH || (u.native === 'japanese' ? 66673 : 66672));
					} else {
						templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${language === 'english' ? '_EN' : ''}`] || (language === 'english' ? 65687 : 65685));
					}
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
			const { email, plan, language, level, native } = req.body || {};
			const normEmail = normalizeEmail(email);
			if (!isValidEmail(normEmail)) return reply.code(400).send({ error: 'valid email required' });
			const planKey = (plan || 'month').toString();
			const PLANS = { month: 2, year: 12 };
			if (!PLANS[planKey]) return reply.code(400).send({ error: 'invalid plan' });
			const ref = Keypair.generate().publicKey.toBase58();
			const orderId = 'ord_' + Math.random().toString(36).slice(2, 10);
			const store = loadOrders();
			store.orders.push({ orderId, reference: ref, status: 'pending', createdAt: Date.now(), email: normEmail, plan: planKey, amount: PLANS[planKey], language: (language || process.env.TARGET_LANGUAGE || 'japanese').toString(), level: (level || 'N3').toString(), native: (native || '').toString() });
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

	// Verify Sui payment by tx digest, coin type, and merchant address
	app.post('/api/sui/verify', async (req, reply) => {
		try {
			const { txDigest, reference } = req.body || {};
			const merchant = (process.env.SUI_MERCHANT_ADDRESS || '').trim();
			const coinType = (process.env.SUI_USDC_COIN_TYPE || '').trim();
			if (!txDigest || typeof txDigest !== 'string') return reply.code(400).send({ error: 'txDigest required' });
			if (!reference || typeof reference !== 'string') return reply.code(400).send({ error: 'reference required' });
			if (!merchant || !coinType) {
				req.log.warn('Sui verification attempted but not configured', { merchant: !!merchant, coinType: !!coinType });
				return reply.code(503).send({ error: 'Sui payment verification is not configured. Please contact support.' });
			}

			async function suiRpc(method, params) {
				try {
					const res = await fetch(SUI_RPC_URL, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params })
					});
					if (!res.ok) throw new Error('Sui RPC error ' + res.status);
					const j = await res.json();
					if (j.error) throw new Error('Sui RPC: ' + (j.error.message || 'unknown'));
					return j.result;
				} catch (error) {
					req.log.error('Sui RPC call failed:', error);
					throw new Error('Unable to verify Sui transaction. Please try again later.');
				}
			}

			// Fetch tx with balance changes
			const result = await suiRpc('sui_getTransactionBlock', [
				txDigest,
				{ showBalanceChanges: true, showEffects: true, showInput: false, showRawInput: false, showEvents: false, showObjectChanges: false }
			]);
			
			if (!result) {
				return reply.code(404).send({ error: 'Transaction not found. Please check the transaction digest.' });
			}
			
			const changes = (result && result.balanceChanges) || [];
			// Sum all positive balance changes for merchant in given coin type
			let receivedUnits = 0n;
			for (const c of changes) {
				try {
					if (c.coinType !== coinType) continue;
					const ownerAddr = (c.owner && (c.owner.AddressOwner || c.owner.ObjectOwner || c.owner.Shared || '')) || '';
					if (String(ownerAddr).toLowerCase() !== merchant.toLowerCase()) continue;
					const delta = BigInt(c.amount || '0');
					if (delta > 0n) receivedUnits += delta;
				} catch (error) {
					req.log.warn('Error processing balance change:', error);
				}
			}

			// Find the pending order by reference and required amount (6 decimals)
			const store = loadOrders();
			const order = store.orders.find(o => o.reference === reference);
			if (!order) return reply.code(404).send({ error: 'order not found' });
			if (order.status === 'paid') return { ok: true, paid: true };
			const requiredUnits = BigInt(Math.round(Number(order.amount) * 1_000_000));
			const paid = receivedUnits >= requiredUnits;
			if (!paid) return { ok: true, paid: false };

			// Mark paid, extend subscription, and send today’s email
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
				current.native = order.native || current.native;
				current.level = order.level || current.level || 'N3';
				current.updatedAt = now;
			} else {
				const expiresAt = now + durationMs;
				subStore.subscribers.push({ email: order.email, language: order.language, native: order.native || '', level: order.level || 'N3', isSubscribed: true, createdAt: now, updatedAt: now, expiresAt });
			}
			saveSubscribers(subStore);

			// Send normal daily email now
			try {
				const user = subStore.subscribers.find(s => normalizeEmail(s.email) === normalizeEmail(order.email));
				const source = process.env.SOURCE_LANGUAGE || 'english';
				const lang = (user && user.language) || order.language || 'japanese';
				const lvl = (user && user.level) || order.level || 'N3';
				const sentence = await generateSentence(source, lang, lvl);
				const templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${lang === 'english' ? '_EN' : lang === 'thai' ? '_TH' : ''}`] || (lang === 'english' ? 65687 : lang === 'thai' ? (user && user.native === 'japanese' ? 66673 : 66672) : 65685));
				const subject = `${lang === 'english' ? '今日の英語' : lang === 'thai' ? '今日のタイ語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
				await sendEmailWithTemplate(order.email, templateId, sentence, subject);
			} catch (e) {
				req.log.error(e);
			}

			return { ok: true, paid: true };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Basic payment check by reference address. Also finalize subscription if paid
	app.get('/api/payments/status', async (req, reply) => {
		try {
			const reference = req.query.reference;
			if (!reference) return reply.code(400).send({ error: 'reference required' });
			
			let connection, sigs, found, paid;
			try {
				connection = new Connection(RPC_URL, { commitment: 'confirmed' });
				sigs = await connection.getSignaturesForAddress(new PublicKey(reference), { limit: 1 });
				found = sigs && sigs.length > 0 ? sigs[0] : null;
				paid = !!found;
			} catch (solanaError) {
				req.log.error('Solana RPC error:', solanaError);
				return reply.code(500).send({ error: 'Unable to check payment status. Please try again later.' });
			}

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
						current.native = order.native || current.native;
						current.level = order.level || current.level || 'N3';
						current.updatedAt = now;
					} else {
						const expiresAt = now + durationMs;
						subStore.subscribers.push({ email: order.email, language: order.language, native: order.native || '', level: order.level || 'N3', isSubscribed: true, createdAt: now, updatedAt: now, expiresAt });
					}
					saveSubscribers(subStore);
					updated = true;

					// Send the normal daily email immediately upon first payment confirmation
					try {
						const user = subStore.subscribers.find(s => normalizeEmail(s.email) === normalizeEmail(order.email));
						const source = process.env.SOURCE_LANGUAGE || 'english';
						const lang = (user && user.language) || order.language || 'japanese';
						const lvl = (user && user.level) || order.level || 'N3';
						const sentence = await generateSentence(source, lang, lvl);
						const templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${lang === 'english' ? '_EN' : ''}`] || (lang === 'english' ? 65687 : 65685));
						const subject = `${lang === 'english' ? '今日の英語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
						await sendEmailWithTemplate(order.email, templateId, sentence, subject);
					} catch (e) {
						req.log.error(e);
					}
				}
			}
			return { paid, signature: found ? found.signature : null, updated };
		} catch (e) {
			return reply.code(500).send({ error: e.message || String(e) });
		}
	});

	// Verify Aptos payment by tx hash, coin type, and merchant address
	app.post('/api/aptos/verify', async (req, reply) => {
		try {
			const { txHash, reference } = req.body || {};
			const merchant = (process.env.APTOS_MERCHANT_ADDRESS || '').trim();
			const coinType = (process.env.APTOS_USDC_COIN_TYPE || '').trim();
			if (!txHash || typeof txHash !== 'string') return reply.code(400).send({ error: 'txHash required' });
			if (!reference || typeof reference !== 'string') return reply.code(400).send({ error: 'reference required' });
			if (!merchant || !coinType) {
				req.log.warn('Aptos verification attempted but not configured', { merchant: !!merchant, coinType: !!coinType });
				return reply.code(503).send({ error: 'Aptos payment verification is not configured. Please contact support.' });
			}

			async function aptosRpc(method, params) {
				try {
					const res = await fetch(APTOS_RPC_URL, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params })
					});
					if (!res.ok) throw new Error('Aptos RPC error ' + res.status);
					const j = await res.json();
					if (j.error) throw new Error('Aptos RPC: ' + (j.error.message || 'unknown'));
					return j.result;
				} catch (error) {
					req.log.error('Aptos RPC call failed:', error);
					throw new Error('Unable to verify Aptos transaction. Please try again later.');
				}
			}

			// Fetch transaction details
			const result = await aptosRpc('get_transaction', [txHash]);
			
			if (!result) {
				return reply.code(404).send({ error: 'Transaction not found. Please check the transaction hash.' });
			}
			
			// Check if transaction is successful
			if (result.success !== true) {
				return reply.code(400).send({ error: 'Transaction failed or is not successful.' });
			}

			// Parse transaction events to find USDC transfers to merchant
			const events = result.events || [];
			let receivedUnits = 0n;
			
			for (const event of events) {
				try {
					// Look for coin transfer events
					if (event.type === '0x1::coin::CoinWithdraw' || event.type === '0x1::coin::CoinDeposit') {
						const data = event.data || {};
						const recipient = data.account || data.deposit_address;
						const amount = data.amount;
						
						if (recipient && amount && String(recipient).toLowerCase() === merchant.toLowerCase()) {
							receivedUnits += BigInt(amount || '0');
						}
					}
				} catch (error) {
					req.log.warn('Error processing Aptos event:', error);
				}
			}

			// Find the pending order by reference and required amount (6 decimals)
			const store = loadOrders();
			const order = store.orders.find(o => o.reference === reference);
			if (!order) return reply.code(404).send({ error: 'order not found' });
			if (order.status === 'paid') return { ok: true, paid: true };
			const requiredUnits = BigInt(Math.round(Number(order.amount) * 1_000_000));
			const paid = receivedUnits >= requiredUnits;
			if (!paid) return { ok: true, paid: false };

			// Mark paid, extend subscription, and send today's email
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
				current.native = order.native || current.native;
				current.level = order.level || current.level || 'N3';
				current.updatedAt = now;
			} else {
				const expiresAt = now + durationMs;
				subStore.subscribers.push({ email: order.email, language: order.language, native: order.native || '', level: order.level || 'N3', isSubscribed: true, createdAt: now, updatedAt: now, expiresAt });
			}
			saveSubscribers(subStore);

			// Send the normal daily email immediately upon first payment confirmation
			try {
				const user = subStore.subscribers.find(s => normalizeEmail(s.email) === normalizeEmail(order.email));
				const source = process.env.SOURCE_LANGUAGE || 'english';
				const lang = (user && user.language) || order.language || 'japanese';
				const lvl = (user && user.level) || order.level || 'N3';
				const sentence = await generateSentence(source, lang, lvl);
				const templateId = Number(process.env[`TENCENT_SES_TEMPLATE_ID${lang === 'english' ? '_EN' : lang === 'thai' ? '_TH' : ''}`] || (lang === 'english' ? 65687 : lang === 'thai' ? (user && user.native === 'japanese' ? 66673 : 66672) : 65685));
				const subject = `${lang === 'english' ? '今日の英語' : lang === 'thai' ? '今日のタイ語' : '今日の日本語'} ${new Date().toLocaleDateString('en-US')}`;
				await sendEmailWithTemplate(order.email, templateId, sentence, subject);
			} catch (e) {
				req.log.error(e);
			}

			return { ok: true, paid: true };
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


