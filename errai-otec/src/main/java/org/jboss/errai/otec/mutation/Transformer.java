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
import java.util.List;

/**
 * @author Mike Brock
 */
public class Transformer {
  private final OTEntity entity;
  private final OTPeer peer;
  private final List<Operation> operations;

  public Transformer(OTEntity entity, OTPeer peer, List<Operation> operations) {
    this.entity = entity;
    this.peer = peer;
    this.operations = operations;
  }

  public void transform() {
    final TransactionLog transactionLog = entity.getTransactionLog();
    final int firstRevision = operations.get(0).getRevision();
    final Collection<Operation> loggedOps = transactionLog.getLogFromId(firstRevision);

    // if no operation was carried out we can just apply the new operations
    if (loggedOps.isEmpty()) {
      for (Operation op : operations) {
        op.apply(entity.getState());
        entity.setRevision(op.getRevision());
      }
    }
    else {
      // transform operations and re-apply
    }
  }
}
