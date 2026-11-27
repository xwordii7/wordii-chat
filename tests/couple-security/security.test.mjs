import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';

import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

import { readFileSync } from 'node:fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-wordii-couple',
  firestore: {
    rules: readFileSync('firestore.rules','utf8')
  }
});

const A = 'test-user-a';
const B = 'test-user-b';
const C = 'test-user-c';

const pair = A+'_'+B;
const code = 'WC-'+pair;

try {
  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();

    for(const person of [A,B,C]){
      await setDoc(doc(db,'users',person),{
        username:person,
        suspended:false,
        admin:false
      });
    }

    await updateDoc(doc(db,'users',A),{
      coupleCode:code,
      coupleBadgeCode:code,
      couplePartnerUid:B
    });

    await updateDoc(doc(db,'users',B),{
      coupleCode:code,
      coupleBadgeCode:code,
      couplePartnerUid:A
    });

    await setDoc(doc(db,'coupleInvites',pair),{
      from:A,
      to:B,
      members:[A,B],
      status:'accepted'
    });

    await setDoc(doc(db,'coupleOrders',pair),{
      from:A,
      to:B,
      members:[A,B],
      status:'approved',
      consent:'accepted',
      badgeCode:code,
      fromUtr:'TEST123456'
    });

    await setDoc(doc(db,'couplePartnerLocks',A),{
      pairId:pair,
      partnerUid:B
    });

    await setDoc(doc(db,'couplePartnerLocks',B),{
      pairId:pair,
      partnerUid:A
    });
  });

  const a = env.authenticatedContext(A).firestore();
  const c = env.authenticatedContext(C).firestore();

  await assertFails(updateDoc(doc(c,'users',A),{
    coupleCode:null,
    coupleBadgeCode:null,
    couplePartnerUid:null
  }));

  console.log('PASS: Stranger cannot remove badge');

  await assertFails(updateDoc(doc(a,'coupleOrders',pair),{
    fromUtr:'CHANGED123'
  }));

  console.log('PASS: Payment history protected');

  await assertFails(updateDoc(doc(a,'users',A),{
    coupleCode:null,
    coupleBadgeCode:null,
    couplePartnerUid:null
  }));

  console.log('PASS: Active badge cannot be cleared alone');

  const batch = writeBatch(a);

  batch.delete(doc(a,'couplePartnerLocks',A));
  batch.delete(doc(a,'couplePartnerLocks',B));

  for(const person of [A,B]){
    batch.update(doc(a,'users',person),{
      coupleCode:null,
      coupleBadgeCode:null,
      couplePartnerUid:null
    });
  }

  batch.update(doc(a,'coupleInvites',pair),{
    status:'disconnected',
    updatedBy:A,
    updatedAt:serverTimestamp()
  });

  batch.update(doc(a,'coupleOrders',pair),{
    status:'disconnected',
    disconnectedBy:A,
    disconnectedAt:serverTimestamp()
  });

  await assertSucceeds(batch.commit());

  console.log('PASS: Atomic couple disconnect');

  await env.withSecurityRulesDisabled(async ctx=>{
    const db = ctx.firestore();

    for(const person of [A,B]){
      const user = await getDoc(doc(db,'users',person));
      const lock = await getDoc(
        doc(db,'couplePartnerLocks',person)
      );

      if(user.data().coupleCode !== null ||
         user.data().coupleBadgeCode !== null ||
         user.data().couplePartnerUid !== null ||
         lock.exists()){
        throw Error('Cleanup incomplete');
      }
    }

    const order = await getDoc(
      doc(db,'coupleOrders',pair)
    );

    if(order.data().status !== 'disconnected' ||
       order.data().fromUtr !== 'TEST123456'){
      throw Error('Order cleanup failed');
    }
  });

  console.log('PASS: Both badges removed');
  console.log('PASS: Both partner locks removed');
  console.log('PASS: Payment history preserved');
  console.log('ALL INITIAL SECURITY TESTS PASSED');

  // Simulate an old disconnected account.
  await env.withSecurityRulesDisabled(async ctx=>{
    const db = ctx.firestore();

    await updateDoc(doc(db,'users',A),{
      coupleCode:code,
      coupleBadgeCode:code,
      couplePartnerUid:B
    });

    await updateDoc(doc(db,'coupleOrders',pair),{
      status:'approved'
    });
  });

  await assertFails(updateDoc(doc(c,'users',A),{
    coupleCode:null,
    coupleBadgeCode:null,
    couplePartnerUid:null
  }));

  console.log('PASS: Unauthorized repair blocked');

  await assertSucceeds(updateDoc(doc(a,'users',A),{
    coupleCode:null,
    coupleBadgeCode:null,
    couplePartnerUid:null
  }));

  console.log('PASS: Old profile badge repaired');

  await assertSucceeds(updateDoc(doc(a,'coupleOrders',pair),{
    status:'disconnected',
    disconnectedBy:A,
    disconnectedAt:serverTimestamp()
  }));

  console.log('PASS: Old disconnected order repaired');

  const newPair = A+'_'+C;
  const newCode = 'WC-'+newPair;

  await env.withSecurityRulesDisabled(async ctx=>{
    const db = ctx.firestore();

    await setDoc(doc(db,'coupleInvites',newPair),{
      from:A,
      to:C,
      members:[A,C],
      status:'accepted'
    });

    await setDoc(doc(db,'couplePartnerLocks',A),{
      pairId:newPair,
      partnerUid:C
    });

    await updateDoc(doc(db,'users',A),{
      coupleCode:newCode,
      couplePartnerUid:C
    });
  });

  const b = env.authenticatedContext(B).firestore();

  await assertFails(updateDoc(doc(b,'users',A),{
    coupleCode:null,
    coupleBadgeCode:null,
    couplePartnerUid:null
  }));

  console.log('PASS: New connection protected from old partner');

  await assertFails(updateDoc(doc(a,'users',A),{
    coupleCode:'FAKE-BADGE'
  }));

  console.log('PASS: Unauthorized badge creation blocked');

  console.log('ALL ADVANCED SECURITY TESTS PASSED');


} finally {
  await env.cleanup();
}
