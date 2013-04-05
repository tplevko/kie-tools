/*
 * Copyright 2013 JBoss, by Red Hat, Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.jboss.errai.otec.mutation;

import java.util.Collection;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/**
 * @author Mike Brock
 */
public class SinglePeerState implements PeerState {
  OTPeer remotePeer;
  final Set<OTEntity> monitoredEntities = Collections.newSetFromMap(new IdentityHashMap<OTEntity, Boolean>());

  @Override
  public OTPeer getPeer(String peerId) {
    return remotePeer;
  }

  @Override
  public void registerPeer(OTPeer peer) {
    if (remotePeer != null) {
      throw new OTException("peer already registered for SinglePeerState!");
    }

    remotePeer = peer;
  }

  @Override
  public Collection<OTPeer> getPeersFor(OTEntity entity) {
    return Collections.singletonList(remotePeer);
  }

  @Override
  public void addPeerMonitor(OTPeer peer, OTEntity entity) {
    monitoredEntities.add(entity);
  }

  @Override
  public void stopPeerMonitor(OTPeer peer, OTEntity entity) {
    monitoredEntities.remove(entity);
  }
}
