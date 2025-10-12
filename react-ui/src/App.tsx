import { useEffect, useRef, useState } from 'react';
import * as solanaWeb3 from '@solana/web3.js';
import { QRCodeSVG } from 'qrcode.react';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function App() {
  const [sentence, setSentence] = useState<any>(null);
  const [sentenceLoading, setSentenceLoading] = useState<boolean>(true);
  const [reference, setReference] = useState<string>('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState<'japanese'|'english'|'thai_en'>('english');
  const [plan, setPlan] = useState<'month'|'year'>('month');
  const [level, setLevel] = useState<string>('B1');
  const targetLang: 'japanese'|'english'|'thai' = language === 'thai_en' ? 'thai' : (language === 'english' ? 'english' : 'japanese');
  const native = language === 'english' ? 'japanese' : language === 'japanese' ? 'english' : 'english';
  const isEnglish = targetLang === 'english';
  const isThai = targetLang === 'thai';
  const [payUrl, setPayUrl] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [solanaPaid, setSolanaPaid] = useState<boolean>(false);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r=>r.ok?r.json():null).then(cfg=>{ 
      if (cfg?.recipient) setRecipient(cfg.recipient);
    }).catch(err => console.error('Config fetch error:', err));
    
    setSentenceLoading(true);
    fetch('/api/daily-sentence?level=' + encodeURIComponent(level) + '&target=' + encodeURIComponent(targetLang) + '&source=' + encodeURIComponent(native))
      .then(r=>r.ok?r.json():null)
      .then(j=>setSentence(j||{}))
      .catch(err => console.error('Sentence fetch error:', err))
      .finally(()=>setSentenceLoading(false));
  }, [level, targetLang, native]);

  // Default is English for Japanese learners
  // Auto-detection removed - site is specifically for Japanese learners

  // Adjust default level whenever target language group changes
  useEffect(() => {
    if (isEnglish) setLevel('B1');
    else if (isThai) setLevel('Intermediate');
    else setLevel('B1'); // Default to B1 for English
  }, [isEnglish, isThai]);

  // (QR deep link only)

  // If user changes plan, clear any existing QR and re-enable subscribe
  useEffect(() => {
    setSolanaPaid(false);
    setReference('');
    setPayUrl('');
  }, [plan]);

  // If user changes email/language/level, also clear prior QR and re-enable
  useEffect(() => {
    setSolanaPaid(false);
    setReference('');
    setPayUrl('');
  }, [email, language, level]);

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


  const onSubscribeSolana = async () => {
    if (!email) { alert('メールアドレスを入力してください'); return; }
    setSolanaPaid(false);
    setLoading(true);
    try {
      const start = await fetch('/api/subscribe/start',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, language: targetLang, plan, level, native })}).then(r=>r.json());
      if (!start?.reference) throw new Error(start?.error||'Failed to start');
      setReference(start.reference);
      const params = new URLSearchParams({ amount: String(start.amount), 'spl-token': USDC_MINT, reference: start.reference, label: 'Subscription Payment', message: 'Thank you!' });
      const url = `solana:${recipient}?${params.toString()}`;
      setPayUrl(url);

      // Try Phantom wallet first (desktop)
      const provider = detectPhantom();
      if (provider) {
        try {
          await provider.connect();
          const payerPk = provider.publicKey as solanaWeb3.PublicKey;
          const resp = await fetch('/tx/usdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payer: payerPk.toBase58(), recipient, amount: start.amount, reference: start.reference }) });
          if (!resp.ok) throw new Error(await resp.text());
          const { transaction } = await resp.json();
          const txBuffer = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
          const tx = solanaWeb3.Transaction.from(txBuffer);
          await provider.signAndSendTransaction(tx);
        } catch (walletErr) {
          // Phantom failed, show QR code
          setQrData(url);
          setShowQR(true);
        }
      } else {
        // No Phantom detected, show QR code
        setQrData(url);
        setShowQR(true);
      }

      // Poll status
      (async function poll() {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const r = await fetch('/api/payments/status?reference=' + encodeURIComponent(start.reference));
            if (!r.ok) continue;
            const j = await r.json();
            if (j && j.paid) {
              setSolanaPaid(true);
              setShowQR(false);
              setReference('');
              setPayUrl('');
              alert('支払いが確認されました！登録が完了しました。');
              return;
            }
          } catch {}
        }
      })();

    } catch(e:any){ alert(e?.message||String(e)); } finally { setLoading(false); }
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
      <h1 style={{textAlign:'center', color:'#1a1a1a'}}>毎日英語を学ぶ</h1>
      <div className="stack" style={{margin:'12px 0 16px'}}>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder='メールアドレス (email@example.com)' style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}/>
        {/* Language selector - English only */}
        <select value={language} onChange={e=>setLanguage(e.target.value as any)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}>
          <option value='english'>English (英語)</option>
        </select>
        {isEnglish ? (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}>
            <option value='A1'>A1 (初級)</option>
            <option value='A2'>A2 (初中級)</option>
            <option value='B1'>B1 (中級)</option>
            <option value='B2'>B2 (中上級)</option>
            <option value='C1'>C1 (上級)</option>
            <option value='C2'>C2 (最上級)</option>
          </select>
        ) : isThai ? (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}>
            <option value='Beginner'>Beginner</option>
            <option value='Intermediate'>Intermediate</option>
            <option value='Advanced'>Advanced</option>
          </select>
        ) : (
          <select value={level} onChange={e=>setLevel(e.target.value)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}>
            <option value='N5'>JLPT N5</option>
            <option value='N4'>JLPT N4</option>
            <option value='N3'>JLPT N3</option>
            <option value='N2'>JLPT N2</option>
            <option value='N1'>JLPT N1</option>
          </select>
        )}
        <select value={plan} onChange={e=>setPlan(e.target.value as any)} style={{padding:12, fontSize:16, borderRadius:10, border:'1px solid #ccc', background:'#fff', color:'#1a1a1a'}}>
          <option value='month'>1ヶ月 — 2 USDC</option>
          <option value='year'>1年 — 12 USDC</option>
        </select>
      </div>
      <div style={{display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:16}}>
        <button onClick={onSubscribeSolana} disabled={loading || solanaPaid} style={{padding:'12px 18px', fontSize:16, fontWeight:700, borderRadius:10, color:'#0b0e14', background:'linear-gradient(135deg, #7c3aed, #6ee7b7)', boxShadow:'0 10px 20px rgba(124,58,237,0.35)'}}>
          {solanaPaid ? '登録完了' : (loading? 'ウォレットを開いています…' : 'Solanaで登録')}
        </button>
      </div>
      {showQR && qrData && (
        <div onClick={() => setShowQR(false)} style={{position:'fixed', top:0, left:0, right:0, bottom:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999}}>
          <div onClick={(e) => e.stopPropagation()} style={{background:'#fff', padding:40, borderRadius:16, textAlign:'center', maxWidth:400}}>
            <h2 style={{marginTop:0, marginBottom:20, color:'#333'}}>QRコードをスキャン</h2>
            <QRCodeSVG value={qrData} size={256} level="H" style={{border:'10px solid #fff', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}} />
            <p style={{marginTop:20, marginBottom:10, fontSize:14, color:'#666'}}>モバイルウォレットでスキャンしてください</p>
            <button onClick={() => setShowQR(false)} style={{marginTop:10, padding:'12px 24px', fontSize:16, borderRadius:8, border:'none', background:'#666', color:'#fff', cursor:'pointer'}}>閉じる</button>
          </div>
        </div>
      )}

      <hr style={{margin:'16px 0', border:'none', borderTop:'1px solid #ddd'}}/>
      {sentenceLoading ? (
        <div style={{display:'flex', alignItems:'center', gap:12, justifyContent:'center'}}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{width:18,height:18,border:'3px solid #ccc',borderTopColor:'#7c3aed',borderRadius:'50%',animation:'spin 1s linear infinite'}}/>
          <div style={{color:'#1a1a1a'}}>読み込み中…</div>
        </div>
      ) : (
        <div>
          {isEnglish ? (
            <>
              {(sentence?.english || sentence?.kanji) && (
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:18, fontWeight:600, color:'#4A90E2', marginBottom:12}}>English (英語)</div>
                  <div style={{fontSize:17, lineHeight:'1.8', color:'#1a1a1a'}}>{sentence?.english || sentence?.kanji}</div>
                </div>
              )}
              
              {sentence?.breakdown && (
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:18, fontWeight:600, color:'#4A90E2', marginBottom:12}}>語彙分解 (Word Breakdown)</div>
                  <div style={{fontSize:17, lineHeight:'1.8', color:'#1a1a1a', whiteSpace:'pre-line'}}>{stripWordClassInBreakdown(sentence.breakdown)}</div>
                </div>
              )}
              
              {sentence?.grammar && (
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:18, fontWeight:600, color:'#4A90E2', marginBottom:12}}>文法説明 (Grammar)</div>
                  <div style={{fontSize:17, lineHeight:'1.8', color:'#1a1a1a', whiteSpace:'pre-line'}}>{sentence.grammar}</div>
                </div>
              )}
              
              {sentence?.meaning && (
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:18, fontWeight:600, color:'#4A90E2', marginBottom:12}}>日本語訳 (Translation)</div>
                  <div style={{fontSize:17, lineHeight:'1.8', color:'#1a1a1a'}}>{sentence.meaning}</div>
                </div>
              )}
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
              <div style={{background:'linear-gradient(to bottom, #fff5f8, #fff)', padding:20, borderRadius:10, marginBottom:20, borderLeft:'4px solid #E91E63'}}>
                {sentence?.kanji && <div style={{marginBottom:12}}><strong style={{color:'#E91E63'}}>漢字:</strong> <span style={{fontSize:20, fontWeight:500}}>{sentence.kanji}</span></div>}
                {sentence?.hiragana && <div style={{marginBottom:12}}><strong style={{color:'#E91E63'}}>ひらがな:</strong> {sentence.hiragana}</div>}
                {sentence?.romaji && <div><strong style={{color:'#E91E63'}}>Romaji:</strong> {sentence.romaji}</div>}
              </div>
              
              {(sentence?.meaning || sentence?.english) && <div style={{marginBottom:8}}><strong style={{fontSize:18, color:'#E91E63'}}>English</strong></div>}
              {(sentence?.meaning || sentence?.english) && <div style={{fontSize:16, marginBottom:20}}>{sentence.meaning || sentence.english}</div>}
              
              {sentence?.breakdown && <div style={{marginTop:24, marginBottom:8}}><strong style={{fontSize:18, color:'#E91E63'}}>Breakdown</strong></div>}
              {sentence?.breakdown && <Lines label='' text={stripWordClassInBreakdown(sentence.breakdown)}/>}
              
              {sentence?.grammar && <div style={{marginTop:24, marginBottom:8}}><strong style={{fontSize:18, color:'#E91E63'}}>Grammar</strong></div>}
              {sentence?.grammar && <Lines label='' text={sentence.grammar}/>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App
