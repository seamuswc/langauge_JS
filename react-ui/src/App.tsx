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
  const targetLang: 'japanese'|'english'|'thai' = language === 'thai_en' || language === 'thai_ja' ? 'thai' : (language as any);
  const native = language === 'english' ? 'japanese' : language === 'japanese' ? 'english' : (language === 'thai_en' ? 'english' : 'japanese');
  const isEnglish = targetLang === 'english';
  const isThai = targetLang === 'thai';
  const [payUrl, setPayUrl] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [paid, setPaid] = useState<boolean>(false);
  // QR removed; keep noop state removed
  const [suiConfig, setSuiConfig] = useState<{ merchant: string; usdcCoinType: string } | null>(null);
  const [suiFlowActive, setSuiFlowActive] = useState<boolean>(false);
  const [suiReference, setSuiReference] = useState<string>('');
  const [suiTxDigest, setSuiTxDigest] = useState<string>('');
  const [suiVerifying, setSuiVerifying] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/config').then(r=>r.ok?r.json():null).then(cfg=>{ 
      if (cfg?.recipient) setRecipient(cfg.recipient);
      if (cfg?.sui) setSuiConfig({ merchant: cfg.sui.merchant || '', usdcCoinType: cfg.sui.usdcCoinType || '' });
    });
    setSentenceLoading(true);
    fetch('/api/daily-sentence?level=' + encodeURIComponent(level) + '&target=' + encodeURIComponent(targetLang) + '&source=' + encodeURIComponent(native))
      .then(r=>r.ok?r.json():null)
      .then(j=>setSentence(j||{}))
      .catch(()=>{})
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
    setPaid(false);
    setReference('');
    setPayUrl('');
  }, [plan]);

  // If user changes email/language/level, also clear prior QR and re-enable
  useEffect(() => {
    setPaid(false);
    setReference('');
    setPayUrl('');
  }, [email, language, level]);

  // Clear Sui flow state when details change
  useEffect(() => {
    setSuiFlowActive(false);
    setSuiReference('');
    setSuiTxDigest('');
  }, [email, language, level, plan]);

  const detectPhantom = () => {
    // @ts-ignore
    if (window.solana && window.solana.isPhantom) { // @ts-ignore
      return window.solana;
    }
    // @ts-ignore
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) { // @ts-ignore
      return window.phantom.solana;
    }
    return null;
  };

  const onSubscribeSolana = async () => {
    if (!email) { alert('Enter email'); return; }
    setPaid(false);
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
              setPaid(true);
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
    if (!suiConfig || !suiConfig.merchant || !suiConfig.usdcCoinType) { alert('Sui not configured.'); return; }
    setPaid(false);
    setLoading(true);
    try {
      const start = await fetch('/api/subscribe/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, language: targetLang, plan, level, native })}).then(r=>r.json());
      if (!start?.reference) throw new Error(start?.error||'Failed to start');
      setSuiReference(start.reference);
      setSuiFlowActive(true);
      // Show instructions section for user to send USDC on Sui and paste tx digest
    } catch(e:any){ alert(e?.message||String(e)); } finally { setLoading(false); }
  };

  const verifySuiPayment = async () => {
    if (!suiReference || !suiTxDigest) { alert('Enter Sui transaction digest'); return; }
    setSuiVerifying(true);
    try {
      const resp = await fetch('/api/sui/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txDigest: suiTxDigest.trim(), reference: suiReference }) });
      const j = await resp.json().catch(()=>({}));
      if (!resp.ok) throw new Error(j?.error || 'Verification failed');
      if (j && j.paid) {
        setPaid(true);
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
        <button onClick={onSubscribeSolana} disabled={loading || paid} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #7c3aed, #6ee7b7)', boxShadow:'0 10px 20px rgba(124,58,237,0.35)'}}>
          {paid ? 'Subscribed' : (loading? 'Opening wallet…' : 'Subscribe with Solana')}
        </button>
        <button onClick={onSubscribeSui} disabled={loading || paid || !suiConfig || !suiConfig.merchant} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #06b6d4, #a7f3d0)', boxShadow:'0 10px 20px rgba(6,182,212,0.35)'}}>
          {paid ? 'Subscribed' : 'Subscribe with Sui'}
        </button>
      </div>
      {reference && payUrl && (
        <div style={{textAlign:'center', margin:'10px 0'}}>
          <a href={payUrl} style={{display:'inline-block', padding:'10px 14px', borderRadius:8, background:'#222', color:'#fff', textDecoration:'none'}}>Open payment in wallet</a>
          <div style={{marginTop:8, fontSize:12, opacity:0.8}}>If it doesn’t open, copy this link into your wallet: <span style={{fontFamily:'monospace', wordBreak:'break-all'}}>{payUrl}</span></div>
        </div>
      )}

      {suiFlowActive && suiConfig && (
        <div style={{textAlign:'center', margin:'12px auto', maxWidth:560}}>
          <div style={{marginBottom:8}}>
            <div style={{opacity:0.85}}>Send</div>
            <div style={{fontWeight:700}}> {plan === 'year' ? '12' : '2'} USDC (Sui mainnet) </div>
            <div style={{opacity:0.85, marginTop:6}}>to</div>
            <div style={{fontFamily:'monospace', wordBreak:'break-all'}}>{suiConfig.merchant}</div>
          </div>
          <div style={{marginTop:12}}>
            <input value={suiTxDigest} onChange={e=>setSuiTxDigest(e.target.value)} placeholder='Paste Sui transaction digest' style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #333', background:'#111', color:'#eee', width:'100%', maxWidth:420}}/>
          </div>
          <div style={{marginTop:10}}>
            <button onClick={verifySuiPayment} disabled={suiVerifying} style={{padding:'10px 16px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #06b6d4, #a7f3d0)'}}>
              {suiVerifying ? 'Verifying…' : 'Verify payment'}
            </button>
          </div>
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
