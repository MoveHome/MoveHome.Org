
const fs=require("fs");
function loadEnv(p){const o={};for(const line of fs.readFileSync(p,"utf8").split("\n")){const m=line.match(/^([A-Za-z_0-9]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,"");}return o;}
const me=loadEnv("/root/projects/movehome/.env.local");
const re=loadEnv("/root/projects/raia/.env.local");
const {createClient}=require("@supabase/supabase-js");
const cm=createClient(me.NEXT_PUBLIC_SUPABASE_URL,me.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const cr=createClient(re.SUPABASE_URL,re.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
(async()=>{
 let rows=[],from=0;
 while(true){const {data,error}=await cm.from("tbl_external_raia_listings").select("raia_id,agent_id,un_locode").range(from,from+999);if(error){console.log("cache",error.message);return;}rows.push(...data);if(data.length<1000)break;from+=1000;}
 console.log("listings",rows.length, "by loc", Object.entries(rows.reduce((a,r)=>(a[r.un_locode]=(a[r.un_locode]||0)+1,a),{})));
 const ids=rows.map(r=>r.raia_id);
 const assets=[];for(let i=0;i<ids.length;i+=200){const {data,error}=await cr.from("tbl_assets").select("asset_id,raia_id").in("raia_id",ids.slice(i,i+200));if(error){console.log("assets",error.message);return;}assets.push(...data);}
 console.log("assets matched",assets.length);
 const byAsset=new Map(assets.map(a=>[a.asset_id,a.raia_id]));
 const media=[];for(let i=0;i<assets.length;i+=100){const {data,error}=await cr.from("tbl_media").select("media_id,asset_id,media_type,storage_provider,storage_path,file_name,description,media_status,deleted_at").in("asset_id",assets.slice(i,i+100).map(a=>a.asset_id)).eq("media_status","active").is("deleted_at",null);if(error){console.log("media",error.message);return;}media.push(...data);}
 console.log("media rows",media.length);
 const c={};for(const m of media){const k=`${m.media_type}|${m.storage_provider}`;c[k]=(c[k]||0)+1;}
 console.log(c);
 const vids=media.filter(m=>m.media_type==="video"&&m.storage_provider==="cloudinary");
 console.log("cloudinary videos",vids.length,"assets with video",new Set(vids.map(v=>v.asset_id)).size);
 for(const v of vids.slice(0,10)) console.log(byAsset.get(v.asset_id),v.file_name,"|",v.description,"|",v.storage_path);
 const t360=media.filter(m=>m.media_type==="360");
 console.log("360",t360.length,"assets",new Set(t360.map(v=>v.asset_id)).size);
 for(const v of t360.slice(0,5)) console.log(byAsset.get(v.asset_id),v.storage_provider,v.storage_path,"|",v.description);
})();
