import {nativeDecode} from './native-decode-validation.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const folder=mkdtempSync(join(tmpdir(),'mok-opus-verify-')),report={files:[],negativeCheck:false};
try{
 const reference=join(folder,'ffmpeg-reference.webm');execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=0.65','-c:a','libopus',reference]);
 for(const file of [reference,...process.argv.slice(2).map(p=>resolve(p))]){
  const packets=spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_packets','-show_entries','packet=size,pts_time','-of','json',file],{encoding:'utf8'});assert.equal(packets.status,0);const data=JSON.parse(packets.stdout).packets;assert.ok(data.length>0);assert.ok(data.every(p=>Number(p.size)>0));
  const args=['-v','error','-i',file,'-map','0:a:0','-ac','2','-ar','48000','-f','f32le','pipe:1'];const decoded=nativeDecode(args,{maxBuffer:8*1024*1024,label:file,opus:true});assert.ok(decoded.stdout.length>0);assert.equal(decoded.stderr.length,0);report.files.push({file,packets:data.length,pcmBytes:decoded.stdout.length,probeWarning:decoded.probeWarning});
 }
 const invalid=join(folder,'invalid.webm');writeFileSync(invalid,Buffer.from('not a webm'));
 assert.throws(()=>nativeDecode(['-v','error','-i',invalid,'-f','null','-'],{maxBuffer:1024*1024,label:'invalid',opus:true}));report.negativeCheck=true;
 console.log(JSON.stringify(report,null,2));
}finally{rmSync(folder,{recursive:true,force:true});}
