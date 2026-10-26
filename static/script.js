let uploadId = null, columns = [], encodingSuggestions = [];
const $ = id => document.getElementById(id);
function show(id, yes=true){$(id).classList.toggle("hidden",!yes)}
function esc(s){return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function tableHTML(rows){if(!rows || !rows.length)return "<p class='muted'>No preview available.</p>";const keys=Object.keys(rows[0]);return "<table><thead><tr>"+keys.map(k=>"<th>"+esc(k)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+keys.map(k=>"<td>"+esc(r[k])+"</td>").join("")+"</tr>").join("")+"</tbody></table>"}

async function refreshDatabaseTables(){
 try{
  const r=await fetch('/api/tables'); const d=await r.json();
  $('dbStatus').textContent=d.database_type==='postgres'?'PostgreSQL mode configured. Available tables: '+(d.tables||[]).length:'PostgreSQL is not configured. Set DATABASE_URL and restart the app.';
  const old=$('dbTable').value;
  $('dbTable').innerHTML='<option value="">Select table</option>'+(d.tables||[]).map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('');
  if((d.tables||[]).includes(old)) $('dbTable').value=old;
 }catch(e){$('dbStatus').textContent='Could not check database status.'}
}
refreshDatabaseTables();
$('referenceForm').addEventListener('submit', async e=>{
 e.preventDefault(); const f=$('referenceFile').files[0]; if(!f)return;
 $('importBtn').disabled=true; $('importStatus').textContent='Importing reference CSV into PostgreSQL in chunks…';
 const fd=new FormData(); fd.append('file',f); fd.append('table_name',$('referenceTable').value); fd.append('key_column',$('referenceKey').value);
 try{const r=await fetch('/api/import-reference',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error||'Import failed');
 $('importStatus').textContent='Import complete: '+Number(d.rows_imported).toLocaleString()+' rows saved to table '+d.table+' . Key: '+d.key_column;
 await refreshDatabaseTables();
 }catch(err){$('importStatus').textContent=err.message}finally{$('importBtn').disabled=false}
});
$('dbTable').addEventListener('change', async()=>{
 const table=$('dbTable').value; if(!table)return;
 try{const r=await fetch('/api/table-columns/'+encodeURIComponent(table));const d=await r.json();if(!r.ok)throw Error(d.error||'Could not get columns');
 $('dbKey').outerHTML='<select id="dbKey"><option value="">Select database key column</option>'+d.columns.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('')+'</select>';
 }catch(e){/* SQLite legacy mode uses a text input for the key column. */}
});

$("uploadForm").addEventListener("submit",async e=>{
 e.preventDefault();const file=$("file").files[0];if(!file)return;
 $("uploadBtn").disabled=true;$("uploadStatus").textContent="Uploading… A 2 GB file may take some time.";
 const form=new FormData();form.append("file",file);
 try{const r=await fetch("/api/columns",{method:"POST",body:form});const data=await r.json();if(!r.ok)throw new Error(data.error||"Upload failed");
 uploadId=data.upload_id;columns=data.columns;$("uploadStatus").textContent=`Uploaded: ${data.filename} (${(file.size/1024/1024).toFixed(1)} MB)`;
 $("datasetKey").innerHTML='<option value="">Select key column</option>'+columns.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
 $("preview").innerHTML=tableHTML(data.preview);show("settings");show("results",false);loadEncodingSuggestions();
 }catch(err){$("uploadStatus").textContent=err.message}finally{$("uploadBtn").disabled=false}
});
$("dbLookup").addEventListener("change",()=>show("dbOptions",$("dbLookup").checked));
$("cleanBtn").addEventListener("click",async()=>{
 if(!uploadId)return;$("cleanBtn").disabled=true;$("cleanStatus").textContent="Cleaning started. Large files may take some time.";
 show("progress");$("bar").style.width="8%";
 const body={upload_id:uploadId,fill_missing:$("fillMissing").checked,remove_duplicates:$("dedupe").checked,convert_numeric:$("convertNumeric").checked,db_lookup:$("dbLookup").checked,db_table:$("dbTable").value,db_key:$("dbKey").value.trim(),dataset_key:$("datasetKey").value};
 // Request stays active while server processes the CSV; reverse-proxy timeout must allow long jobs.
 let pulse=8;const ticker=setInterval(()=>{pulse=Math.min(94,pulse+1);$("bar").style.width=pulse+"%"},1500);
 try{const r=await fetch("/api/clean",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||"Cleaning failed");
 $("bar").style.width="100%";$("cleanStatus").textContent="Cleaning complete.";const x=data.report;
 $("stats").innerHTML=[["Rows scanned",x.rows],["Columns",x.columns],["Duplicates removed",x.rows_removed],["Rows output",x.rows_written],["Database cells filled",x.database_cells_filled],["DB matches",x.database_matches]].map(a=>`<div class="stat"><strong>${Number(a[1]||0).toLocaleString()}</strong><span>${esc(a[0])}</span></div>`).join("");
 $("suggestions").innerHTML=(x.ai_suggestions||[]).map(s=>"<li>"+esc(s)+"</li>").join("");
 $("missing").innerHTML=tableHTML(Object.entries(x.missing_before||{}).map(([column,count])=>({column,missing_cells:count,default_fill:x.missing_fill_values?.[column]||"No safe default"})));
 $("download").href=data.download_url;show("results");
 }catch(err){$("cleanStatus").textContent=err.message}finally{clearInterval(ticker);$("cleanBtn").disabled=false}
});


async function loadEncodingSuggestions(){
 if(!uploadId)return;
 show("encodingPanel");
 $("encodingSuggestions").textContent="Analyzing sample data and category counts…";
 try{
  const r=await fetch("/api/encoding-suggestions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({upload_id:uploadId})});
  const d=await r.json(); if(!r.ok)throw new Error(d.error||"Could not get suggestions");
  const suggestions=d.suggestions||[]; encodingSuggestions=suggestions;
  if(!suggestions.length){$("encodingSuggestions").textContent="No clear categorical columns were found in the sample. Select columns manually if needed. "+(d.note||"");}
  else $("encodingSuggestions").innerHTML="<strong>Suggested columns ("+esc(d.source==="openai"?"AI model":"rule-based fallback")+"):</strong><ul>"+suggestions.map(s=>"<li><b>"+esc(s.column)+"</b> — "+esc(s.method==="onehot"?"One-Hot":"Label Encoding")+"; "+esc(s.reason)+(s.confidence!==undefined?" <em>(confidence "+Math.round(Number(s.confidence)*100)+"%)</em>":"")+(s.risk?"<br><small>Risk: "+esc(s.risk)+"</small>":"")+"</li>").join("")+"</ul><small>"+esc(d.note||"Review AI advice before applying it.")+"</small>";
  $("encodingColumns").innerHTML=columns.map(c=>{const s=suggestions.find(x=>x.column===c);return "<label><input type=\"checkbox\" class=\"encode-column\" value=\""+esc(c)+"\" "+(s?"checked":"")+"> "+esc(c)+(s?" <small>(suggest: "+esc(s.method)+")</small>":"")+"</label>"}).join("");
 }catch(e){$("encodingSuggestions").textContent=e.message;$("encodingColumns").innerHTML=columns.map(c=>"<label><input type=\"checkbox\" class=\"encode-column\" value=\""+esc(c)+"\"> "+esc(c)+"</label>").join("");}
}

$("encodeBtn").addEventListener("click",async()=>{
 const selected=[...document.querySelectorAll(".encode-column:checked")].map(x=>x.value);
 if(!selected.length){$("encodingStatus").textContent="Select at least one column first.";return;}
 $("encodeBtn").disabled=true;$("encodingStatus").textContent="Encoding in progress. Large files may take some time.";show("encodedDownload",false);
 try{const r=await fetch("/api/encode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({upload_id:uploadId,method:$("encodingMethod").value,columns:selected})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Encoding failed");$("encodedDownload").href=d.download_url;show("encodedDownload");await loadEncodedPreview(d.download_url);$("encodingStatus").textContent="Encoding complete. Columns: "+selected.join(", ")+". "+d.note;}catch(e){$("encodingStatus").textContent=e.message;}finally{$("encodeBtn").disabled=false;}
});


$("autoEncodeBtn").addEventListener("click",async()=>{
 const selected=[...document.querySelectorAll(".encode-column:checked")].map(x=>x.value);
 if(!selected.length){$("encodingStatus").textContent="Select at least one column first.";return;}
 const advice=Object.fromEntries(encodingSuggestions.map(s=>[s.column,s.method]));
 const method_by_column={}; for(const col of selected){method_by_column[col]=advice[col]||"onehot";}
 $("autoEncodeBtn").disabled=true;$("encodingStatus").textContent="Applying suggested methods and encoding…";show("encodedDownload",false);
 try{const r=await fetch("/api/encode",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({upload_id:uploadId,columns:selected,method_by_column,auto_apply:true})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Automatic encoding failed");$("encodedDownload").href=d.download_url;show("encodedDownload");await loadEncodedPreview(d.download_url);$("encodingStatus").textContent="Automatic encoding complete. Methods: "+selected.map(c=>c+" = "+(method_by_column[c]==="onehot"?"One-Hot":"Label")).join("; ")+". "+d.note;}catch(e){$("encodingStatus").textContent=e.message;}finally{$("autoEncodeBtn").disabled=false;}
});

async function loadEncodedPreview(url) {
    const status = $("previewStatus");
    if (!status) return;

    status.textContent = "Loading encoded dataset...";
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Could not load encoded CSV (HTTP " + response.status + ").");
        }

        const csvText = await response.text();
        showEncodedPreview(csvText);
    } catch (error) {
        status.textContent = "Preview could not be loaded: " + error.message;
        console.error("Encoded preview error:", error);
    }
}

function showEncodedPreview(csvText) {
    const status = $("previewStatus");
    const table = $("encodedPreviewTable");

    if (!status || !table) {
        console.error("Preview elements not found. Check index.html IDs.");
        return;
    }

    if (typeof csvText !== "string" || !csvText.trim()) {
        status.textContent = "No encoded data available.";
        return;
    }

    let headers = [];
    let rows = [];

    // Papa Parse is preferred when loaded; fallback parser handles ordinary quoted CSV.
    if (typeof Papa !== "undefined" && typeof Papa.parse === "function") {
        const parsed = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: false
        });

        if (parsed.errors && parsed.errors.length) {
            console.warn("CSV parsing warnings:", parsed.errors);
        }

        headers = parsed.meta.fields || [];
        rows = parsed.data || [];
    } else {
        const parseCSV = text => {
            const records = [];
            let row = [], value = "", quoted = false;

            for (let i = 0; i < text.length; i++) {
                const ch = text[i];

                if (ch === '"') {
                    if (quoted && text[i + 1] === '"') {
                        value += '"';
                        i++;
                    } else {
                        quoted = !quoted;
                    }
                } else if (ch === "," && !quoted) {
                    row.push(value);
                    value = "";
                } else if ((ch === "\n" || ch === "\r") && !quoted) {
                    if (ch === "\r" && text[i + 1] === "\n") i++;
                    row.push(value);
                    if (row.some(cell => cell !== "")) records.push(row);
                    row = [];
                    value = "";
                } else {
                    value += ch;
                }
            }

            row.push(value);
            if (row.some(cell => cell !== "")) records.push(row);
            return records;
        };

        const records = parseCSV(csvText);
        if (!records.length) {
            status.textContent = "No data available for preview.";
            return;
        }

        headers = records[0];
        rows = records.slice(1).map(values => {
            const obj = {};
            headers.forEach((header, i) => obj[header] = values[i] ?? "");
            return obj;
        });
    }

    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    if (!headers.length || !rows.length) {
        thead.replaceChildren();
        tbody.replaceChildren();
        status.textContent = "No data available for preview.";
        return;
    }

    thead.replaceChildren();
    tbody.replaceChildren();

    const headerRow = document.createElement("tr");
    headers.forEach(header => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    rows.slice(0, 10).forEach(row => {
        const tr = document.createElement("tr");
        headers.forEach(header => {
            const td = document.createElement("td");
            td.textContent = row[header] ?? "";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    status.textContent = `Showing ${Math.min(rows.length, 10)} of ${rows.length} rows and ${headers.length} columns.`;
}
