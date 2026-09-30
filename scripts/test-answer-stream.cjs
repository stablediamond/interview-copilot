const assert = require('node:assert/strict');
const { createAnswerTracker } = require('../electron/chatgpt-answer-stream.cjs');
const realNow=Date.now;let now=1000;Date.now=()=>now;
try {
 const baseline={userCount:1,userKey:'u1',assistantKey:'a1',expectedPrompt:'Explain this'};
 const track=createAnswerTracker(baseline);
 assert.equal(track({...baseline,userText:'Explain this',text:'Old answer',afterUser:true,busy:false}),null);
 const next={userCount:2,userKey:'u2',assistantKey:'a2',userText:'Explain this',afterUser:true,busy:true,text:'Hello'};
 assert.equal(track({...next,userText:'Unrelated conversation'}),null);
 assert.equal(track({...next,afterUser:false}),null);
 assert.deepEqual(track(next),{text:'Hello',revision:2,done:false});
 assert.equal(track(next),null);
 now+=1000;assert.deepEqual(track({...next,text:'Hello world'}),{text:'Hello world',revision:3,done:false});
 now+=3000;assert.equal(track({...next,text:'Hello world'}),null,'Active generation is not complete');
 assert.deepEqual(track({...next,text:'Hello world',busy:false}),{text:'Hello world',revision:4,done:true});
 assert.equal(track({...next,text:'Later unrelated answer'}),null);
 console.log('Answer stream tests passed: old/unrelated answer isolation, incremental revisions, active generation, completion, and terminal state.');
} finally {Date.now=realNow;}
