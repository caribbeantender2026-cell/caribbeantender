// CaribbeanTender general browser logic. Authentication is handled in auth.js.
const page = location.pathname.split('/').pop() || 'index.html';
const db = () => window.supabaseClient;

function setYear(){ document.querySelectorAll('.year').forEach(e => e.textContent = new Date().getFullYear()); }
function esc(v=''){ const e=document.createElement('div'); e.textContent=v; return e.innerHTML; }
function money(v){ return new Intl.NumberFormat('en-JM',{style:'currency',currency:'JMD'}).format(Number(v)); }
function fmtDate(v){ if(!v)return ''; return new Intl.DateTimeFormat('en-JM',{dateStyle:'medium'}).format(new Date(`${v}T00:00:00`)); }
function message(text,type='success'){
  let b=document.getElementById('appMessage');
  if(!b){ b=document.createElement('div'); b.id='appMessage'; document.querySelector('main')?.prepend(b); }
  b.className=`notice ${type==='error'?'error':''}`; b.textContent=text;
}
function busy(form,on){ const b=form.querySelector('button[type="submit"]'); if(!b)return; b.disabled=on; b.dataset.label ||= b.textContent; b.textContent=on?'Please wait…':b.dataset.label; }

async function signedUrl(bucket,path){ if(!path)return null; const {data,error}=await db().storage.from(bucket).createSignedUrl(path,300); return error?null:data.signedUrl; }
async function upload(bucket,file){
  if(!file?.size)return null;
  if(file.size>10*1024*1024) throw new Error('Documents must be 10 MB or smaller.');
  const user=await getCurrentUser(); if(!user) throw new Error('Please log in first.');
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  const path=`${user.id}/${crypto.randomUUID()}-${safe}`;
  const {error}=await db().storage.from(bucket).upload(path,file,{contentType:file.type});
  if(error)throw error; return {path,name:file.name};
}

function wireTenderForm(){
  if(page!=='create-tender.html')return;
  const form=document.querySelector('form'); if(!form)return;
  const [title,description,closingDate,documentInput]=form.querySelectorAll('input,textarea');
  form.addEventListener('submit',async e=>{
    e.preventDefault(); busy(form,true);
    try{
      const user=await getCurrentUser(); if(!user)throw new Error('Please log in first.');
      const doc=await upload('tender-documents',documentInput?.files?.[0]);
      const payload={business_id:user.id,title:title.value.trim(),description:description.value.trim(),closing_date:closingDate.value,status:'open',document_path:doc?.path||null,document_name:doc?.name||null};
      const {data,error}=await db().from('tenders').insert(payload).select('id').single();
      if(error)throw error;
      message('Tender published successfully.');
      setTimeout(()=>location.href=`tender-details.html?id=${data.id}`,400);
    }catch(error){ message(error.message||'Unable to publish tender.','error'); }
    finally{ busy(form,false); }
  });
}

function wireBidForm(){
  if(page!=='submit-bid.html')return;
  const form=document.querySelector('form'); if(!form)return;
  const inputs=form.querySelectorAll('input'); const amountInput=inputs[0], documentInput=inputs[1];
  form.addEventListener('submit',async e=>{
    e.preventDefault(); busy(form,true);
    try{
      const user=await getCurrentUser(); if(!user)throw new Error('Please log in first.');
      const tenderId=new URLSearchParams(location.search).get('id'); if(!tenderId)throw new Error('No tender was selected.');
      const amount=Number(String(amountInput.value).replace(/[^0-9.]/g,'')); if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a valid bid amount.');
      const doc=await upload('bid-documents',documentInput?.files?.[0]); if(!doc)throw new Error('Please select a proposal document.');
      const {error}=await db().from('bids').insert({tender_id:tenderId,supplier_id:user.id,amount,document_path:doc.path,document_name:doc.name});
      if(error)throw error; form.reset(); message('Your bid was submitted successfully.');
    }catch(error){ message(error.message||'Unable to submit bid.','error'); }
    finally{ busy(form,false); }
  });
}

async function profileNames(ids){
  const unique=[...new Set(ids.filter(Boolean))]; if(!unique.length)return {};
  const {data,error}=await db().from('profiles').select('id,company_name,full_name').in('id',unique);
  if(error)return {};
  return Object.fromEntries((data||[]).map(p=>[p.id,p.company_name||p.full_name||'Business']));
}

async function renderTenderRows(){
  const body=document.getElementById('tenderRows'); if(!body||!db())return;
  const today=new Date().toISOString().slice(0,10);
  const {data,error}=await db().from('tenders').select('id,business_id,title,closing_date,status').eq('status','open').gte('closing_date',today).order('closing_date');
  if(error){ body.innerHTML=`<tr><td colspan="5">${esc(error.message)}</td></tr>`; return; }
  const names=await profileNames((data||[]).map(t=>t.business_id));
  body.innerHTML=(data||[]).length?(data||[]).map(t=>`<tr><td>${esc(t.title)}</td><td>${esc(names[t.business_id]||'Business')}</td><td>${fmtDate(t.closing_date)}</td><td><span class="badge">Open</span></td><td><a class="btn" href="tender-details.html?id=${encodeURIComponent(t.id)}">View Details</a></td></tr>`).join(''):'<tr><td colspan="5">No open tenders found.</td></tr>';
}

async function renderDetails(){
  const box=document.getElementById('tenderDetails'); if(!box||!db())return;
  const id=new URLSearchParams(location.search).get('id'); if(!id){box.textContent='No tender was selected.';return;}
  const {data:t,error}=await db().from('tenders').select('*').eq('id',id).single();
  if(error||!t){box.textContent='Tender not found.';return;}
  const names=await profileNames([t.business_id]); const url=await signedUrl('tender-documents',t.document_path);
  const open=t.status==='open'&&t.closing_date>=new Date().toISOString().slice(0,10);
  box.innerHTML=`<h2>${esc(t.title)}</h2><p><strong>Business:</strong> ${esc(names[t.business_id]||'Business')}</p><p><strong>Closing Date:</strong> ${fmtDate(t.closing_date)}</p><p>${esc(t.description)}</p>${url?`<p><strong>Supporting Document:</strong> <a href="${url}" target="_blank" rel="noopener">${esc(t.document_name||'Download')}</a></p>`:''}<div class="actions">${open?`<a class="btn" href="submit-bid.html?id=${encodeURIComponent(t.id)}">Submit Bid</a>`:''}<a class="btn gold" href="tenders.html">Back to Tenders</a></div>`;
}

async function renderMyTenders(){
  const body=document.getElementById('myTenderRows'); if(!body||!db())return;
  const user=await getCurrentUser(); if(!user)return;
  const {data,error}=await db().from('tenders').select('id,title,closing_date,status').eq('business_id',user.id).order('created_at',{ascending:false});
  if(error){body.innerHTML=`<tr><td colspan="4">${esc(error.message)}</td></tr>`;return;}
  let totalBids=0; const rows=[];
  for(const t of data||[]){
    const countRes=await db().from('bids').select('*',{count:'exact',head:true}).eq('tender_id',t.id); const count=countRes.count||0; totalBids+=count;
    rows.push(`<tr><td>${esc(t.title)}</td><td>${fmtDate(t.closing_date)}</td><td>${count}</td><td><a class="btn" href="view-bids.html?id=${encodeURIComponent(t.id)}">View Bids</a></td></tr>`);
  }
  body.innerHTML=rows.join('')||'<tr><td colspan="4">You have not published a tender yet.</td></tr>';
  const s=document.querySelectorAll('.stat strong'); if(s.length>=3){s[0].textContent=(data||[]).length;s[1].textContent=totalBids;s[2].textContent=(data||[]).filter(t=>t.status==='open').length;}
}

async function renderBids(){
  const body=document.getElementById('bidRows'); if(!body||!db())return;
  const id=new URLSearchParams(location.search).get('id'); if(!id)return;
  const {data,error}=await db().from('bids').select('*').eq('tender_id',id).order('created_at');
  if(error){body.innerHTML=`<tr><td colspan="4">${esc(error.message)}</td></tr>`;return;}
  const names=await profileNames((data||[]).map(b=>b.supplier_id));
  const rows=[]; for(const b of data||[]){const url=await signedUrl('bid-documents',b.document_path); rows.push(`<tr><td>${esc(names[b.supplier_id]||'Supplier')}</td><td>${money(b.amount)}</td><td>${new Date(b.created_at).toLocaleDateString('en-JM')}</td><td>${url?`<a href="${url}" target="_blank" rel="noopener">${esc(b.document_name||'Proposal')}</a>`:'Unavailable'}</td></tr>`);} body.innerHTML=rows.join('')||'<tr><td colspan="4">No bids have been submitted.</td></tr>';
}

async function renderSupplierStats(){
  if(page!=='supplier-dashboard.html'||!db())return; const user=await getCurrentUser(); if(!user)return;
  const today=new Date().toISOString().slice(0,10);
  const [open,bids]=await Promise.all([db().from('tenders').select('*',{count:'exact',head:true}).eq('status','open').gte('closing_date',today),db().from('bids').select('*',{count:'exact',head:true}).eq('supplier_id',user.id)]);
  const s=document.querySelectorAll('.stat strong'); if(s[0])s[0].textContent=open.count||0;if(s[1])s[1].textContent=bids.count||0;if(s[2])s[2].textContent='1';
}

document.addEventListener('DOMContentLoaded',async()=>{
  setYear();
  if(!window.supabaseClient){ message('Supabase did not initialize. Check assets/supabase-config.js and confirm the CDN script loads first.','error'); return; }
  wireTenderForm(); wireBidForm();
  try{ await Promise.all([renderTenderRows(),renderDetails(),renderMyTenders(),renderBids(),renderSupplierStats()]); }
  catch(error){ console.error(error); message(error.message||'The page could not load data from Supabase.','error'); }
});
