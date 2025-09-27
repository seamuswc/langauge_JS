import { useEffect, useRef, useState } from 'react';
import * as solanaWeb3 from '@solana/web3.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function App() {
  const [sentence, setSentence] = useState<any>(null);
  const [sentenceLoading, setSentenceLoading] = useState<boolean>(true);
  const [reference, setReference] = useState<string>('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState<'japanese'|'english'|'thai_en'|'thai_ja'>('japanese');
  const [plan, setPlan] = useState<'month'|'year'>('month');
  const [level, setLevel] = useState<string>('N3');
  const targetLang: 'japanese'|'english'|'thai' = language === 'thai_en' || language === 'thai_ja' ? 'thai' : (language === 'english' ? 'english' : 'japanese');
  const native = language === 'english' ? 'japanese' : language === 'japanese' ? 'english' : (language === 'thai_en' ? 'english' : 'japanese');
  const isEnglish = targetLang === 'english';
  const isThai = targetLang === 'thai';
  const [payUrl, setPayUrl] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [solanaPaid, setSolanaPaid] = useState<boolean>(false);
  const [suiPaid, setSuiPaid] = useState<boolean>(false);
  const [aptosPaid, setAptosPaid] = useState<boolean>(false);
  // QR removed; keep noop state removed
  const [suiConfig, setSuiConfig] = useState<{ merchant: string; usdcCoinType: string } | null>(null);
  const [suiFlowActive, setSuiFlowActive] = useState<boolean>(false);
  const [suiReference, setSuiReference] = useState<string>('');
  const [suiTxDigest, setSuiTxDigest] = useState<string>('');
  const [suiVerifying, setSuiVerifying] = useState<boolean>(false);
  const [aptosConfig, setAptosConfig] = useState<{ merchant: string; usdcCoinType: string } | null>(null);
  const [aptosFlowActive, setAptosFlowActive] = useState<boolean>(false);
  const [aptosReference, setAptosReference] = useState<string>('');
  const [aptosTxHash, setAptosTxHash] = useState<string>('');
  const [aptosVerifying, setAptosVerifying] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/config').then(r=>r.ok?r.json():null).then(cfg=>{ 
      if (cfg?.recipient) setRecipient(cfg.recipient);
      if (cfg?.sui) setSuiConfig({ merchant: cfg.sui.merchant || '', usdcCoinType: cfg.sui.usdcCoinType || '' });
      if (cfg?.aptos) setAptosConfig({ merchant: cfg.aptos.merchant || '', usdcCoinType: cfg.aptos.usdcCoinType || '' });
    }).catch(err => console.error('Config fetch error:', err));
    
    setSentenceLoading(true);
    fetch('/api/daily-sentence?level=' + encodeURIComponent(level) + '&target=' + encodeURIComponent(targetLang) + '&source=' + encodeURIComponent(native))
      .then(r=>r.ok?r.json():null)
      .then(j=>setSentence(j||{}))
      .catch(err => console.error('Sentence fetch error:', err))
      .finally(()=>setSentenceLoading(false));
  }, [level, targetLang, native]);

  // Reset default level when language changes
  // Run language auto-detection only once on first load
  const initialLangSet = useRef(false);
  useEffect(() => {
    if (initialLangSet.current) return;
    initialLangSet.current = true;
    try {
      const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) as string[];
      const primary = (langs && langs[0] ? String(langs[0]) : '').toLowerCase();
      if (primary.startsWith('ja')) setLanguage('english');
      else if (primary.startsWith('en')) setLanguage('japanese');
    } catch {}
  }, []);

  // Adjust default level whenever target language group changes
  useEffect(() => {
    if (isEnglish) setLevel('B1');
    else if (isThai) setLevel('Intermediate');
    else setLevel('N3');
  }, [isEnglish, isThai]);

  // (QR deep link only)

  // If user changes plan, clear any existing QR and re-enable subscribe
  useEffect(() => {
    setSolanaPaid(false);
    setSuiPaid(false);
    setAptosPaid(false);
    setReference('');
    setPayUrl('');
  }, [plan]);

  // If user changes email/language/level, also clear prior QR and re-enable
  useEffect(() => {
    setSolanaPaid(false);
    setSuiPaid(false);
    setAptosPaid(false);
    setReference('');
    setPayUrl('');
  }, [email, language, level]);

  // Clear Sui flow state when details change
  useEffect(() => {
    setSuiFlowActive(false);
    setSuiReference('');
    setSuiTxDigest('');
  }, [email, language, level, plan]);

  // Clear Aptos flow state when details change
  useEffect(() => {
    setAptosFlowActive(false);
    setAptosReference('');
    setAptosTxHash('');
  }, [email, language, level, plan]);

  const detectPhantom = () => {
    // Type-safe Phantom wallet detection
    const windowWithSolana = window as any;
    if (windowWithSolana.solana && windowWithSolana.solana.isPhantom) {
      return windowWithSolana.solana;
    }
    if (windowWithSolana.phantom && windowWithSolana.phantom.solana && windowWithSolana.phantom.solana.isPhantom) {
      return windowWithSolana.phantom.solana;
    }
    return null;
  };

  const detectSuiWallet = () => {
    // Type-safe Sui wallet detection
    const windowWithSui = window as any;
    if (windowWithSui.suiWallet) {
      return windowWithSui.suiWallet;
    }
    if (windowWithSui.sui) {
      return windowWithSui.sui;
    }
    if (windowWithSui.__suiWallet) {
      return windowWithSui.__suiWallet;
    }
    return null;
  };

  const detectAptosWallet = () => {
    // Type-safe Aptos wallet detection
    const windowWithAptos = window as any;
    if (windowWithAptos.aptos) {
      return windowWithAptos.aptos;
    }
    if (windowWithAptos.petra) {
      return windowWithAptos.petra;
    }
    if (windowWithAptos.martian) {
      return windowWithAptos.martian;
    }
    if (windowWithAptos.rise) {
      return windowWithAptos.rise;
    }
    return null;
  };

  const onSubscribeSolana = async () => {
    if (!email) { alert('Enter email'); return; }
    setSolanaPaid(false);
    setLoading(true);
    try {
      const start = await fetch('/api/subscribe/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, language: targetLang, plan, level, native })}).then(r=>r.json());
      if (!start?.reference) throw new Error(start?.error||'Failed to start');
      setReference(start.reference);
      const params = new URLSearchParams({ amount: String(start.amount), 'spl-token': USDC_MINT, reference: start.reference, label: 'Subscription Payment', message: 'Thank you!' });
      const url = `solana:${recipient}?${params.toString()}`;
      setPayUrl(url);

      // Attempt Phantom flow
      const provider = detectPhantom();
      if (provider) {
        await provider.connect();
        const payerPk = provider.publicKey as solanaWeb3.PublicKey;
        const resp = await fetch('/tx/usdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payer: payerPk.toBase58(), recipient, amount: start.amount, reference: start.reference }) });
        if (!resp.ok) throw new Error(await resp.text());
        const { transaction } = await resp.json();
        const txBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
        const tx = solanaWeb3.Transaction.from(txBuffer);
        await provider.signAndSendTransaction(tx);
      } else {
        // Fallback: deep link to any registered Solana wallet (desktop or mobile)
        try { if (url) window.location.href = url; } catch {}
      }

      // Poll status
      (async function poll() {
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const r = await fetch('/api/payments/status?reference=' + encodeURIComponent(start.reference));
            if (!r.ok) continue;
            const j = await r.json();
            if (j && j.paid) {
              setSolanaPaid(true);
              // Hide QR and clear reference to prevent reusing same payment link
              setReference('');
              setPayUrl('');
              alert('Payment confirmed! Subscription activated.');
              return;
            }
          } catch {}
        }
      })();

    } catch(e:any){ alert(e?.message||String(e)); } finally { setLoading(false); }
  };

  const onSubscribeSui = async () => {
    if (!email) { alert('Enter email'); return; }
    setSuiPaid(false);
    setLoading(true);
    try {
      const start = await fetch('/api/subscribe/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, language: targetLang, plan, level, native })}).then(r=>r.json());
      if (!start?.reference) throw new Error(start?.error||'Failed to start');
      setSuiReference(start.reference);

      // Try to auto-detect and use Sui wallet
      const suiProvider = detectSuiWallet();
      if (suiProvider && suiConfig && suiConfig.merchant) {
        try {
          // Connect to Sui wallet
          await suiProvider.connect();
          
          // Try to create and sign transaction automatically
          const amount = start.amount;
          const recipient = suiConfig.merchant;
          const coinType = suiConfig.usdcCoinType;
          
          if (coinType && suiProvider.signAndExecuteTransactionBlock) {
            try {
              // Create USDC transfer transaction
              const txb = new suiProvider.TransactionBlock();
              
              // Split coins for the payment amount (in smallest units)
              const amountUnits = Math.round(Number(amount) * 1_000_000); // 6 decimals for USDC
              const [coin] = txb.splitCoins(txb.gas, [amountUnits]);
              
              // Transfer to recipient
              txb.transferObjects([coin], recipient);
              
              // Sign and execute transaction
              const result = await suiProvider.signAndExecuteTransactionBlock({
                transactionBlock: txb,
                options: {
                  showEffects: true,
                  showObjectChanges: true
                }
              });
              
              if (result && result.digest) {
                // Transaction successful, verify payment
                setSuiTxDigest(result.digest);
                await verifySuiPayment();
                return;
              }
            } catch (txError) {
              console.error('Sui transaction error:', txError);
              // Fall through to manual process
            }
          }
          
          // Fallback to manual process with wallet connected
          setSuiFlowActive(true);
          alert(`Sui wallet connected! Please send ${amount} USDC to ${recipient} and paste the transaction digest below.`);
        } catch (walletError) {
          console.error('Sui wallet error:', walletError);
          setSuiFlowActive(true);
          alert('Sui wallet connection failed. Please send USDC manually and paste the transaction digest.');
        }
      } else {
        // Fallback to manual process
        setSuiFlowActive(true);
        if (!suiConfig || !suiConfig.merchant) {
          alert('Sui not configured. Please contact support or use Solana payment.');
        }
      }
    } catch(e:any){ alert(e?.message||String(e)); } finally { setLoading(false); }
  };

  const onSubscribeAptos = async () => {
    if (!email) { alert('Enter email'); return; }
    setAptosPaid(false);
    setLoading(true);
    try {
      const start = await fetch('/api/subscribe/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, language: targetLang, plan, level, native })}).then(r=>r.json());
      if (!start?.reference) throw new Error(start?.error||'Failed to start');
      setAptosReference(start.reference);

      // Try to auto-detect and use Aptos wallet
      const aptosProvider = detectAptosWallet();
      if (aptosProvider && aptosConfig && aptosConfig.merchant) {
        try {
          // Connect to Aptos wallet
          await aptosProvider.connect();
          
          // Try to create and sign transaction automatically
          const amount = start.amount;
          const recipient = aptosConfig.merchant;
          const coinType = aptosConfig.usdcCoinType;
          
          if (coinType && aptosProvider.signAndSubmitTransaction) {
            try {
              // Create USDC transfer transaction
              const amountUnits = Math.round(Number(amount) * 1_000_000); // 6 decimals for USDC
              
              const transaction = {
                type: "entry_function_payload",
                function: "0x1::coin::transfer",
                arguments: [recipient, amountUnits],
                type_arguments: [coinType]
              };
              
              // Sign and execute transaction
              const result = await aptosProvider.signAndSubmitTransaction(transaction);
              
              if (result && result.hash) {
                // Transaction successful, verify payment
                setAptosTxHash(result.hash);
                await verifyAptosPayment();
                return;
              }
            } catch (txError) {
              console.error('Aptos transaction error:', txError);
              // Fall through to manual process
            }
          }
          
          // Fallback to manual process with wallet connected
          setAptosFlowActive(true);
          alert(`Aptos wallet connected! Please send ${amount} USDC to ${recipient} and paste the transaction hash below.`);
        } catch (walletError) {
          console.error('Aptos wallet error:', walletError);
          setAptosFlowActive(true);
          alert('Aptos wallet connection failed. Please send USDC manually and paste the transaction hash.');
        }
      } else {
        // Fallback to manual process
        setAptosFlowActive(true);
        if (!aptosConfig || !aptosConfig.merchant) {
          alert('Aptos not configured. Please contact support or use Solana payment.');
        }
      }
    } catch(e:any){ alert(e?.message||String(e)); } finally { setLoading(false); }
  };

  const verifyAptosPayment = async () => {
    if (!aptosReference || !aptosTxHash) { alert('Enter Aptos transaction hash'); return; }
    setAptosVerifying(true);
    try {
      const resp = await fetch('/api/aptos/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: aptosTxHash.trim(), reference: aptosReference }) });
      const j = await resp.json().catch(()=>({}));
      if (!resp.ok) throw new Error(j?.error || 'Verification failed');
      if (j && j.paid) {
        setAptosPaid(true);
        setAptosFlowActive(false);
        setAptosReference('');
        setAptosTxHash('');
        alert('Payment confirmed! Subscription activated.');
      } else {
        alert('Not paid yet. Please check the hash and try again.');
      }
    } catch(e:any) {
      alert(e?.message||String(e));
    } finally { setAptosVerifying(false); }
  };

  const verifySuiPayment = async () => {
    if (!suiReference || !suiTxDigest) { alert('Enter Sui transaction digest'); return; }
    setSuiVerifying(true);
    try {
      const resp = await fetch('/api/sui/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txDigest: suiTxDigest.trim(), reference: suiReference }) });
      const j = await resp.json().catch(()=>({}));
      if (!resp.ok) throw new Error(j?.error || 'Verification failed');
      if (j && j.paid) {
        setSuiPaid(true);
        setSuiFlowActive(false);
        setSuiReference('');
        setSuiTxDigest('');
        alert('Payment confirmed! Subscription activated.');
      } else {
        alert('Not paid yet. Please check the digest and try again.');
      }
    } catch(e:any) {
      alert(e?.message||String(e));
    } finally { setSuiVerifying(false); }
  };

  const stripWordClassInBreakdown = (value?: string): string | undefined => {
    if (!value) return value;
    const posKeywords = [
      // English POS
      'noun','verb','adjective','adverb','pronoun','preposition','conjunction','interjection',
      'article','determiner','auxiliary','auxiliary verb','modal','particle','gerund','phrase',
      'verb phrase','noun phrase','adjective phrase','aux','aux verb',
      // Japanese POS
      '名詞','動詞','形容詞','形容動詞','副詞','代名詞','助詞','助動詞','連体詞','接続詞','感動詞',
      '前置詞','冠詞','接頭辞','接尾辞'
    ];
    const isPos = (inner: string) => {
      const s = inner.trim().toLowerCase();
      if (!s) return false;
      if (posKeywords.includes(s)) return true;
      // handle things like "auxiliary-verb", "verb phrase", language variants/spaces
      if (/^(aux(iliary)?(\s+verb)?|modal(\s+verb)?|verb\s*phrase|noun\s*phrase|adjective\s*phrase)$/i.test(inner)) return true;
      return false;
    };
    // Remove only parentheses that contain POS terms; keep others (e.g., readings/meanings)
    return value.replace(/[\(（]([^\)）]*)[\)）]/g, (match, inner) => isPos(inner) ? '' : match)
                .replace(/\s{2,}/g, ' ').trim();
  };

  const Lines = ({label, text}:{label:string, text?:string}) => {
    if (!text) return null;
    const lines = String(text).split('\n').map(s=>s.trim()).filter(Boolean);
    return (
      <div style={{marginTop:12}}>
        {label && <strong>{label}:</strong>}
        {lines.length>1? <div>{lines.map((l,i)=>(<div key={i} style={{margin:'6px 0'}}>{l}</div>))}</div> : <> {lines[0]}</> }
      </div>
    );
  };

  return (
    <div style={{maxWidth:560, margin:'3vh auto', padding:24, textAlign:'center'}}>
      <h1 style={{textAlign:'center'}}>Subscribe for Daily Sentences</h1>
      <div className="stack" style={{margin:'12px 0 16px'}}>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder='you@example.com' style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}/>
        <select value={language} onChange={e=>setLanguage(e.target.value as any)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}>
          <option value='japanese'>Japanese</option>
          <option value='english'>英語</option>
          <option value='thai_en'>Thai</option>
          <option value='thai_ja'>タイ</option>
        </select>
        {isEnglish ? (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}>
            <option value='A1'>A1</option>
            <option value='A2'>A2</option>
            <option value='B1'>B1</option>
            <option value='B2'>B2</option>
            <option value='C1'>C1</option>
            <option value='C2'>C2</option>
          </select>
        ) : isThai ? (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}>
            <option value='Beginner'>Beginner</option>
            <option value='Intermediate'>Intermediate</option>
            <option value='Advanced'>Advanced</option>
          </select>
        ) : (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}>
            <option value='N5'>JLPT N5</option>
            <option value='N4'>JLPT N4</option>
            <option value='N3'>JLPT N3</option>
            <option value='N2'>JLPT N2</option>
            <option value='N1'>JLPT N1</option>
          </select>
        )}
        <select value={plan} onChange={e=>setPlan(e.target.value as any)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee'}}>
          <option value='month'>1 month — 2 USDC</option>
          <option value='year'>1 year — 12 USDC</option>
        </select>
      </div>
      <div style={{display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:16}}>
        <button onClick={onSubscribeSolana} disabled={loading || solanaPaid} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #7c3aed, #6ee7b7)', boxShadow:'0 10px 20px rgba(124,58,237,0.35)'}}>
          {solanaPaid ? 'Subscribed' : (loading? 'Opening wallet…' : 'Subscribe with Solana')}
        </button>
        <button onClick={onSubscribeSui} disabled={loading || suiPaid} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #06b6d4, #a7f3d0)', boxShadow:'0 10px 20px rgba(6,182,212,0.35)'}}>
          {suiPaid ? 'Subscribed' : 'Subscribe with Sui'}
        </button>
        <button onClick={onSubscribeAptos} disabled={loading || aptosPaid} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #3b82f6, #8b5cf6)', boxShadow:'0 10px 20px rgba(59,130,246,0.35)'}}>
          {aptosPaid ? 'Subscribed' : 'Subscribe with Aptos'}
        </button>
      </div>
      {reference && payUrl && (
        <div style={{textAlign:'center', margin:'10px 0'}}>
          <a href={payUrl} style={{display:'inline-block', padding:'10px 14px', borderRadius:8, background:'#222', color:'#fff', textDecoration:'none'}}>Open payment in wallet</a>
          <div style={{marginTop:8, fontSize:12, opacity:0.8}}>If the wallet doesn't open, you need to install a Solana wallet like Phantom.</div>
        </div>
      )}

      {suiFlowActive && (
        <div style={{textAlign:'center', margin:'12px auto', maxWidth:560}}>
          <div style={{marginBottom:8}}>
            <div style={{opacity:0.85}}>Send</div>
            <div style={{fontWeight:700}}> {plan === 'year' ? '12' : '2'} USDC (Sui mainnet) </div>
            <div style={{opacity:0.85, marginTop:6}}>to</div>
            {suiConfig && suiConfig.merchant ? (
              <div style={{fontFamily:'monospace', wordBreak:'break-all', backgroundColor:'#222', padding:'8px', borderRadius:'4px'}}>{suiConfig.merchant}</div>
            ) : (
              <div style={{fontFamily:'monospace', wordBreak:'break-all', backgroundColor:'#333', padding:'8px', borderRadius:'4px', color:'#ff6b6b'}}>
                Sui merchant address not configured. Please contact support.
              </div>
            )}
          </div>
          <div style={{marginTop:12}}>
            <input value={suiTxDigest} onChange={e=>setSuiTxDigest(e.target.value)} placeholder='Paste Sui transaction digest' style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee', width:'100%', maxWidth:420}}/>
          </div>
          <div style={{marginTop:10}}>
            <button onClick={verifySuiPayment} disabled={suiVerifying || !suiConfig || !suiConfig.merchant} style={{padding:'10px 16px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #06b6d4, #a7f3d0)', opacity: (!suiConfig || !suiConfig.merchant) ? 0.5 : 1}}>
              {suiVerifying ? 'Verifying…' : 'Verify payment'}
            </button>
          </div>
          {(!suiConfig || !suiConfig.merchant) && (
            <div style={{marginTop:8, fontSize:12, color:'#ff6b6b'}}>
              Sui payment verification is not configured. Please contact support.
            </div>
          )}
        </div>
      )}

      {aptosFlowActive && (
        <div style={{textAlign:'center', margin:'12px auto', maxWidth:560}}>
          <div style={{marginBottom:8}}>
            <div style={{opacity:0.85}}>Send</div>
            <div style={{fontWeight:700}}> {plan === 'year' ? '12' : '2'} USDC (Aptos mainnet) </div>
            <div style={{opacity:0.85, marginTop:6}}>to</div>
            {aptosConfig && aptosConfig.merchant ? (
              <div style={{fontFamily:'monospace', wordBreak:'break-all', backgroundColor:'#222', padding:'8px', borderRadius:'4px'}}>{aptosConfig.merchant}</div>
            ) : (
              <div style={{fontFamily:'monospace', wordBreak:'break-all', backgroundColor:'#333', padding:'8px', borderRadius:'4px', color:'#ff6b6b'}}>
                Aptos merchant address not configured. Please contact support.
              </div>
            )}
          </div>
          <div style={{marginTop:12}}>
            <input value={aptosTxHash} onChange={e=>setAptosTxHash(e.target.value)} placeholder='Paste Aptos transaction hash' style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee', width:'100%', maxWidth:420}}/>
          </div>
          <div style={{marginTop:10}}>
            <button onClick={verifyAptosPayment} disabled={aptosVerifying || !aptosConfig || !aptosConfig.merchant} style={{padding:'10px 16px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #3b82f6, #8b5cf6)', opacity: (!aptosConfig || !aptosConfig.merchant) ? 0.5 : 1}}>
              {aptosVerifying ? 'Verifying…' : 'Verify payment'}
            </button>
          </div>
          {(!aptosConfig || !aptosConfig.merchant) && (
            <div style={{marginTop:8, fontSize:12, color:'#ff6b6b'}}>
              Aptos payment verification is not configured. Please contact support.
            </div>
          )}
        </div>
      )}
      <hr style={{margin:'16px 0'}}/>
      {sentenceLoading ? (
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{width:18,height:18,border:'3px solid #999',borderTopColor:'#7c3aed',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
          <div>Loading sentence…</div>
        </div>
      ) : (
        <div>
          {isEnglish ? (
            <>
              {sentence?.kanji && <Lines label='English' text={sentence.kanji}/>}
              {sentence?.hiragana && <Lines label='Reading' text={sentence.hiragana}/>}
              <div style={{height:16}}/>
              {sentence?.breakdown && <div style={{marginTop:12}}><strong>Word Breakdown:</strong></div>}
              {sentence?.breakdown && <Lines label='' text={stripWordClassInBreakdown(sentence.breakdown)}/>}
              <div style={{height:16}}/>
              {sentence?.grammar && <div style={{marginTop:12}}><strong>Grammar:</strong></div>}
              {sentence?.grammar && <Lines label='' text={sentence.grammar}/>}
              <div style={{height:16}}/>
              {(sentence?.meaning || sentence?.english) && <Lines label='Japanese' text={sentence.meaning || sentence.english}/>}
            </>
          ) : isThai ? (
            <>
              {(() => { const L = native === 'japanese'
                ? { thai: 'タイ語', reading: '読み方', wb: '語彙分解', grammar: '文法', trans: '日本語' }
                : { thai: 'Thai', reading: 'Reading', wb: 'Word Breakdown', grammar: 'Grammar', trans: 'English' };
                return (
                  <>
                    {sentence?.kanji && <Lines label={L.thai} text={sentence.kanji}/>}
                    {sentence?.hiragana && <Lines label={L.reading} text={sentence.hiragana}/>}
                    <div style={{height:16}}/>
                    {sentence?.breakdown && <div style={{marginTop:12}}><strong>{L.wb}:</strong></div>}
                    {sentence?.breakdown && <Lines label='' text={stripWordClassInBreakdown(sentence.breakdown)}/>}
                    <div style={{height:16}}/>
                    {sentence?.grammar && <div style={{marginTop:12}}><strong>{L.grammar}:</strong></div>}
                    {sentence?.grammar && <Lines label='' text={sentence.grammar}/>}
                    <div style={{height:16}}/>
                    {(sentence?.meaning || sentence?.english) && (
                      <Lines label={L.trans} text={sentence.meaning || sentence.english}/>
                    )}
                  </>
                ); })()}
            </>
          ) : (
            <>
              {sentence?.kanji && <Lines label='漢字' text={sentence.kanji}/>}
              {sentence?.hiragana && <Lines label='ひらがな' text={sentence.hiragana}/>}
              {sentence?.romaji && <Lines label='Romaji' text={sentence.romaji}/>}
              <div style={{height:16}}/>
              {(sentence?.meaning || sentence?.english) && <Lines label='English' text={sentence.meaning || sentence.english}/>}
              <div style={{height:16}}/>
              {sentence?.breakdown && <div style={{marginTop:12}}><strong>Breakdown:</strong></div>}
              {sentence?.breakdown && <Lines label='' text={stripWordClassInBreakdown(sentence.breakdown)}/>}
              <div style={{height:16}}/>
              {sentence?.grammar && <div style={{marginTop:12}}><strong>Grammar:</strong></div>}
              {sentence?.grammar && <Lines label='' text={sentence.grammar}/>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App
