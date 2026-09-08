import './test-loader.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const {createProject,createTextOverlay,defaultCaptionStyle,normalizeProject}=await import('../src/lib/defaults.ts');
const {useEditor,undo,beginInteraction,endInteraction}=await import('../src/store/editor.ts');
const {useUI}=await import('../src/store/ui.ts');
const {useProjectOwnership}=await import('../src/lib/projectOwnership.ts');
const {textOverlayAt,textOverlaysInRange,trimTextOverlay}=await import('../src/lib/textOverlays.ts');
const {cameraPoseTimes,totalDuration,editableDuration}=await import('../src/lib/animation.ts');
const {exportAssets}=await import('../src/export/assets.ts');
const {startTextOverlayPosition,canPositionCaption}=await import('../src/lib/captionPosition.ts');
const reset=(p=createProject())=>{useProjectOwnership.setState({enabled:false});useUI.setState({time:0,playing:false,recording:false,timelineMode:'simple',activeTextOverlayId:null,cameraPose:null,captionPosition:null,modal:null,cropShot:null,exporting:null,autoMotion:false});useEditor.getState().replaceProject(p);useEditor.temporal.getState().clear();return useEditor.getState().project;};
const p=()=>useEditor.getState().project;
test('old attached captions and full-frame text are retained while independent tracks normalize IDs, times and typography',()=>{
 const source=createProject();source.shots[0].caption=defaultCaptionStyle();source.textOverlays=[{...createTextOverlay(),id:source.shots[0].id,start:-2,duration:999,x:Infinity,text:{text:'hello',size:NaN}}, {...createTextOverlay(),start:179.95,duration:5,layer:'invalid'}];
 const result=normalizeProject(JSON.parse(JSON.stringify(source)));assert.deepEqual(result.shots[0].caption,source.shots[0].caption);assert.notEqual(result.textOverlays[0].id,result.shots[0].id);assert.equal(result.textOverlays[0].start,0);assert.equal(result.textOverlays[0].duration,180);assert.equal(result.textOverlays[1].start,179.9);assert.ok(result.textOverlays[1].start+result.textOverlays[1].duration<=180);assert.equal(result.textOverlays[1].layer,'front');assert.ok(Number.isFinite(result.textOverlays[0].text.size));
 assert.equal(normalizeProject(createProject()).textOverlays,undefined);
});
test('overlaps are independent, half-open and scoped for still/video font loading',()=>{
 const source=createProject();source.shots=[source.shots[0]];source.textOverlays=[createTextOverlay('First',0,2),createTextOverlay('Second',1,2),createTextOverlay('Later',4,1),{...createTextOverlay('Disabled',0,5),enabled:false}];source.textOverlays.forEach((t,i)=>t.text.font=`font${i}`);
 assert.equal(textOverlayAt(source.textOverlays[0],2),false);assert.deepEqual(textOverlaysInRange(source,1.5).map(t=>t.name),['First','Second']);assert.deepEqual(exportAssets(source,{type:'still',time:2},true).fonts.map(t=>t.font),['font1']);assert.deepEqual(exportAssets(source,{type:'video',start:0,end:2},true).fonts.map(t=>t.font),['font0','font1']);
});
test('converting a legacy split caption preserves its absolute timing and is one undo',()=>{
 const source=createProject();source.shots[1].gap=2;source.shots[1].caption={...defaultCaptionStyle(),timing:{offset:2,duration:8}};reset(source);const before=structuredClone(p());const id=useEditor.getState().convertCaption(source.shots[1].id);const t=p().textOverlays[0];assert.equal(t.id,id);assert.equal(t.start,source.shots[0].duration+2);assert.equal(t.duration,source.shots[1].duration);assert.deepEqual(t.timing,{offset:2,duration:8});assert.equal(p().shots[1].caption,undefined);assert.equal(useEditor.temporal.getState().pastStates.length,1);undo();assert.deepEqual(p(),before);
});
test('independent text extends the endpoint, retains timing through shot reorders and deletes with undo',()=>{
 reset();const id=useEditor.getState().addTextOverlay(8,4);assert.equal(totalDuration(p()),12);assert.equal(editableDuration(p()),12);const t=structuredClone(p().textOverlays[0]);useEditor.getState().reorderShot(p().shots[1].id,0);assert.deepEqual(p().textOverlays[0],t);useEditor.getState().removeTextOverlay(id);assert.equal(totalDuration(p()),12);assert.equal(useUI.getState().activeTextOverlayId,null);undo();assert.deepEqual(p().textOverlays[0],t);
});
test('duplicate/copy/paste keep independent objects, timing, array layer order and portable values',()=>{
 reset();const first=useEditor.getState().addTextOverlay(1,3);useEditor.getState().duplicateTextOverlay(first);const second=p().textOverlays[1].id;useEditor.getState().updateTextOverlay(second,t=>{t.text.text='Second';});assert.notEqual(p().textOverlays[0].text.text,'Second');useEditor.getState().reorderTextOverlay(first,1);assert.equal(p().textOverlays[1].id,first);useEditor.getState().copyTextOverlay(first);useUI.getState().setTime(7);useEditor.getState().pasteTextOverlay();assert.equal(p().textOverlays[2].start,7);assert.equal(p().textOverlays[2].duration,3);assert.equal(new Set(p().textOverlays.map(t=>t.id)).size,3);assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p()))).textOverlays,p().textOverlays);
});
test('head trims retain enter phase and tail trims move exit to the new boundary',()=>{
 const original=createTextOverlay('Trim',2,6),track=structuredClone(original);trimTextOverlay(track,original,'start',4);assert.deepEqual(track.timing,{offset:2,duration:6});assert.equal(track.duration,4);const before=structuredClone(track);trimTextOverlay(track,before,'end',6);assert.equal(track.duration,2);assert.deepEqual(track.timing,{offset:2,duration:4});trimTextOverlay(track,original,'start',0);assert.deepEqual(track.timing,{offset:0,duration:8});assert.equal(track.duration,8);
});
test('camera slots include equally spaced endpoints and changing slot count/mode never resamples Advanced keys',()=>{
 const source=createProject();source.shots=[source.shots[0]];const shot=source.shots[0];shot.duration=6;shot.keyframes={'camera.x':[{t:0,v:10,ease:'linear',cp:[.1,.2,.8,.9]},{t:1.2,v:80,ease:'easeOut'},{t:6,v:20,ease:'smooth'}]};reset(source);const before=structuredClone(p().shots[0].keyframes);useEditor.getState().updateShot(shot.id,s=>s.cameraPoseCount=4);assert.deepEqual(cameraPoseTimes(p().shots[0]),[0,2,4,6]);useUI.getState().setTimelineMode('advanced');useUI.getState().setTimelineMode('simple');assert.deepEqual(p().shots[0].keyframes,before);useEditor.getState().selectCameraPose(shot.id,1);useEditor.getState().setValue('camera.x',33);let keys=p().shots[0].keyframes['camera.x'];assert.equal(keys.length,4);assert.equal(keys.find(k=>k.t===2).v,33);assert.deepEqual(keys.filter(k=>k.t!==2),before['camera.x']);useEditor.getState().selectCameraPose(shot.id,3);beginInteraction();useEditor.getState().setValue('camera.x',99);endInteraction();keys=p().shots[0].keyframes['camera.x'];assert.equal(keys.length,4);assert.equal(keys.at(-1).t,6);assert.equal(keys.at(-1).v,99);undo();assert.equal(p().shots[0].keyframes['camera.x'].at(-1).v,20);
});
test('editing an empty Simple camera pose initializes endpoint holds and leaves other scenes unchanged',()=>{
 reset();const second=structuredClone(p().shots[1]),id=p().shots[0].id;useEditor.getState().selectCameraPose(id,1);useEditor.getState().setValue('camera.zoom',2);const keys=p().shots[0].keyframes['camera.zoom'];assert.deepEqual(keys.map(k=>k.t),[0,1.5,3]);assert.equal(keys[1].v,2);assert.deepEqual(p().shots[1],second);
});
test('text positioning seeks visible content; read-only blocks every text mutator and project switching clears edit tools',()=>{
 reset();const id=useEditor.getState().addTextOverlay(4,3);assert.equal(startTextOverlayPosition(id),true);assert.equal(canPositionCaption(),true);assert.equal(useUI.getState().time,4.3);const before=structuredClone(p());useProjectOwnership.setState({enabled:true,projectId:p().id,mode:'readonly',token:null});assert.equal(startTextOverlayPosition(id),false);assert.equal(canPositionCaption(),false);useEditor.getState().removeTextOverlay(id);useEditor.getState().duplicateTextOverlay(id);useEditor.getState().addTextOverlay();useEditor.getState().updateTextOverlay(id,t=>t.name='blocked');assert.deepEqual(p(),before);const another={...structuredClone(before),id:'another'};useEditor.getState().replaceProject(another);assert.equal(useUI.getState().activeTextOverlayId,null);assert.equal(useUI.getState().captionPosition,null);reset();
});

test('shortened text animations render identically before and after portable normalization',()=>{
 const source=createProject(),t=createTextOverlay('Short',0,6);t.enter={effect:'fade',duration:2};t.exit={effect:'fade',duration:.3};source.textOverlays=[t];reset(source);useEditor.getState().updateTextOverlay(t.id,t=>trimTextOverlay(t,structuredClone(t),'end',.5));assert.deepEqual(normalizeProject(p()).textOverlays,p().textOverlays);useEditor.getState().updateTextOverlay(t.id,t=>{t.duration=.1;delete t.timing;});assert.deepEqual(normalizeProject(p()).textOverlays,p().textOverlays);
});
