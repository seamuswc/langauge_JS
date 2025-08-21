(function () {
	let CONFIG = { usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", recipient: "8zS5w8MHSDQ4Pc12DZRLYQ78hgEwnBemVJMrfjUN6xXj", defaultAmount: 2 };

	function assertDeps() {
		const missing = [];
		if (!window.solanaWeb3) missing.push("@solana/web3.js");
		if (!(typeof window.QRCode === "function" || (window.QRCode && typeof window.QRCode.toCanvas === "function"))) missing.push("qrcode");
		if (missing.length) throw new Error("Missing: " + missing.join(", "));
	}

	function detectPhantomProvider() {
		if (window.solana && window.solana.isPhantom) return window.solana;
		if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) return window.phantom.solana;
		return null;
	}

	function buildSolanaPayUrl(recipient, queryParams) {
		const params = new URLSearchParams(queryParams);
		return `solana:${recipient}?${params.toString()}`;
	}

	function renderQr(el, text) {
		el.innerHTML = "";
		if (typeof window.QRCode === "function") {
			new window.QRCode(el, { text, width: 280, height: 280, correctLevel: window.QRCode.CorrectLevel.M });
			return;
		}
		if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
			const canvas = document.createElement("canvas");
			window.QRCode.toCanvas(canvas, text, { errorCorrectionLevel: "M", margin: 1, width: 280 }, function (err) {
				if (!err) el.appendChild(canvas);
			});
		}
	}

	async function handlePhantomPay(referenceStr) {
		const provider = detectPhantomProvider();
		if (!provider) { alert("Phantom not detected"); return; }
		await provider.connect();
		const payerPk = provider.publicKey;
		const recipientPk = new solanaWeb3.PublicKey(CONFIG.recipient);
		const referencePk = new solanaWeb3.PublicKey(referenceStr);

		const resp = await fetch('/tx/usdc', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ payer: payerPk.toBase58(), recipient: recipientPk.toBase58(), amount: CONFIG.defaultAmount, reference: referencePk.toBase58() })
		});
		if (!resp.ok) throw new Error(await resp.text());
		const { transaction } = await resp.json();
		const txBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
		const tx = solanaWeb3.Transaction.from(txBuffer);
		const signed = await provider.signAndSendTransaction(tx);
		alert("Paid! " + signed.signature);
	}

	function renderSentence(j) {
		const sentenceEl = document.getElementById('sentence');
		if (!sentenceEl) return;
		const kanji = j.kanji || '';
		const hiragana = j.hiragana || '';
		const romaji = j.romaji || '';
		const english = j.meaning || j.english || '';
		const breakdownItems = String(j.breakdown || '').split('\n').map(s => s.trim()).filter(Boolean);
		const grammarItems = String(j.grammar || '').split('\n').map(s => s.trim()).filter(Boolean);

		const spacer = '<div style="height:16px"></div>';
		const block = (label, value) => value ? `<div style=\"margin:8px 0\"><strong>${label}:</strong> ${value}</div>` : '';

		sentenceEl.innerHTML = [
			block('漢字', kanji),
			spacer,
			block('ひらがな', hiragana),
			spacer,
			block('Romaji', romaji),
			spacer,
			block('English', english),
			spacer,
			'<div style=\"margin:8px 0\"><strong>Breakdown:</strong></div>',
			breakdownItems.map(s => `<div style=\"margin:6px 0\">${s}</div>`).join(''),
			spacer,
			'<div style=\"margin:8px 0\"><strong>Grammar:</strong></div>',
			grammarItems.map(s => `<div style=\"margin:6px 0\">${s}</div>`).join('')
		].filter(Boolean).join('');
	}

	function init() {
		assertDeps();
		let reference = null;
		const label = "Subscription Payment";
		const message = "Thank you!";

		// Fetch a daily sentence
		fetch('/api/daily-sentence')
			.then(r => r.ok ? r.json() : null)
			.then(j => { if (j) renderSentence(j); })
			.catch(() => {});

		// Subscribe form
		const form = document.getElementById('subscribe-form');
		if (form) {
			form.addEventListener('submit', async function (e) {
				e.preventDefault();
				const email = document.getElementById('email').value.trim();
				const language = document.getElementById('language').value;
				const plan = document.getElementById('plan').value;
				if (!email) return;
				// Start order to get reference and amount
				let start;
				try {
					const resp = await fetch('/api/subscribe/start', {
						method: 'POST', headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email, language, plan })
					});
					start = await resp.json();
					if (!resp.ok) throw new Error(start && start.error || 'Failed to start');
				} catch (err) { alert('Failed to start payment: ' + err.message); return; }

				const query = { amount: String(start.amount), "spl-token": CONFIG.usdcMint, reference: start.reference, label, message };
				const payUrl = buildSolanaPayUrl(CONFIG.recipient, query);
				const qrEl = document.getElementById("qr");
				qrEl.style.display = '';
				document.getElementById('ref-line').style.display = '';
				document.getElementById('ref-text').textContent = start.reference;
				renderQr(qrEl, payUrl);
				// Also try provider flow automatically
				try { await handlePhantomPay(start.reference); } catch (_) {}

				// Poll payment status until confirmed
				(async function poll() {
					for (let i = 0; i < 30; i++) {
						await new Promise(r => setTimeout(r, 2000));
						try {
							const r = await fetch('/api/payments/status?reference=' + encodeURIComponent(start.reference));
							if (!r.ok) continue;
							const j = await r.json();
							if (j && j.paid) { alert('Payment confirmed! Subscription activated.'); return; }
						} catch (_) {}
					}
					alert('Payment not confirmed yet. You can complete it later from your wallet.');
				})();
			});
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();


