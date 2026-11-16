
const {createClient}=require("@supabase/supabase-js");
const c=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
(async()=>{
 const {data,error}=await c.from("tbl_media").select("media_tags,usage,description,file_name,media_type,storage_provider").eq("media_type","video").limit(100000);
 if(error) return console.log(error.message);
 const tags={}, usage={};
 for(const r of data){ if(r.media_tags) tags[JSON.stringify(r.media_tags)]=(tags[JSON.stringify(r.media_tags)]||0)+1; if(r.usage) usage[JSON.stringify(r.usage)]=(usage[JSON.stringify(r.usage)]||0)+1;}
 console.log("tags",tags); console.log("usage",usage);
})();
