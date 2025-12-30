/**
 * OFFLINE MANAGER - CORE ENGINE V15 (Performance & Loop Fix)
 * ----------------------------------------------------
 * Opgelost: Oneindige lus tussen getSmartCollection en refreshCache verwijderd.
 * Verbeterd: Sync-locking en ID-mapping nog robuuster.
 */

class DataGateway {
    constructor(baseUrl, clientId, appName) {
        this.baseUrl = baseUrl;
        this.clientId = clientId;
        this.appName = appName;
    }

    _getUrl(collectionName, id = null) {
        let url = `${this.baseUrl}/api/${this.appName}_${collectionName}`;
        if (id) url += `/${id}`;
        return url;
    }

    async getCollection(name) {
        const response = await fetch(this._getUrl(name), {
            headers: { 'x-client-id': this.clientId }
        });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        return await response.json();
    }

    async saveDocument(name, data) {
        const method = data._id ? 'PUT' : 'POST';
        const url = this._getUrl(name, data._id);
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'x-client-id': this.clientId },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`Save error: ${response.status}`);
        return await response.json();
    }

    async deleteDocument(name, id) {
        const response = await fetch(this._getUrl(name, id), {
            method: 'DELETE',
            headers: { 'x-client-id': this.clientId }
        });
        if (!response.ok) throw new Error(`Delete error: ${response.status}`);
        return await response.json();
    }
}

class OfflineManager {
    constructor(baseUrl, clientId, appName) {
        this.appName = appName;
        this.gateway = new DataGateway(baseUrl, clientId, appName);
        this.db = new Dexie(`OfflineEngine_${appName}_${clientId}`);
        
        this.db.version(1).stores({
            data: "++id, collection, _id",
            outbox: "++id, action, collection"
        });

        this.isSyncing = false;
        this.onSyncChange = null;
        this.onDataChanged = null;
        this.isOfflineSimulated = false;
    }

    /**
     * Slaat op en start sync op de achtergrond.
     */
    async saveSmartDocument(collectionName, data) {
        let record = JSON.parse(JSON.stringify(data));

        // Ensure we have a valid local ID for database operations
        if (!record.id && !record._id) {
            // Generate a temporary local ID if none exists
            record.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
        }

        // Look for existing record using valid keys only
        let existing = null;
        if (record.id && !isNaN(Number(record.id))) {
            try {
                existing = await this.db.data.get(Number(record.id));
            } catch (e) {
                console.warn('[Manager] Invalid key lookup for record.id:', record.id);
            }
        }

        if (!existing && record._id) {
            try {
                existing = await this.db.data.where({ collection: collectionName, _id: record._id }).first();
            } catch (e) {
                console.warn('[Manager] Invalid key lookup for record._id:', record._id);
            }
        }

        // Update record with existing data if found
        if (existing) {
            if (existing._id) record._id = existing._id;
            if (existing.id) record.id = existing.id;
        }

        const localRecord = { ...record, collection: collectionName };

        // Ensure localRecord has a valid numeric ID for IndexedDB
        if (record.id && !isNaN(Number(record.id))) {
            localRecord.id = Number(record.id);
        } else if (record._id) {
            // If we have a server ID but no local ID, look for existing record
            const existingWithServerId = await this.db.data.where({ collection: collectionName, _id: record._id }).first();
            if (existingWithServerId) {
                localRecord.id = existingWithServerId.id;
            }
        }

        try {
            const savedId = await this.db.data.put(localRecord);
            localRecord.id = savedId;

            const action = localRecord._id ? 'PUT' : 'POST';

            // Clean up any existing pending operations safely
            const existingPending = await this.db.outbox.where({ collection: collectionName })
                .filter(o => {
                    // Only compare if we have valid IDs
                    if (o.payload.id && !isNaN(Number(o.payload.id))) {
                        return Number(o.payload.id) === savedId;
                    }
                    return false;
                }).first();

            if (existingPending) {
                await this.db.outbox.update(existingPending.id, { payload: localRecord });
            } else {
                await this.db.outbox.add({ action, collection: collectionName, payload: localRecord });
            }

            // Trigger sync zonder de UI te blokkeren
            if (navigator.onLine && !this.isOfflineSimulated) this.syncOutbox();
            return localRecord;
        } catch (error) {
            console.error('[Manager] Failed to save document:', error, localRecord);
            throw error;
        }
    }

    async deleteSmartDocument(collectionName, id) {
        // Validate input ID
        if (!id || (typeof id !== 'string' && typeof id !== 'number')) {
            console.warn('[Manager] Invalid ID for delete:', id);
            return;
        }

        const idString = String(id);

        try {
            // Find item using multiple strategies to handle invalid IDs gracefully
            let item = null;

            // Try to find by _id first
            if (idString.length > 10) { // Likely a server ID
                item = await this.db.data.where({ collection: collectionName, _id: idString }).first();
            }

            // If not found, try to find by local id (if it's numeric)
            if (!item && !isNaN(Number(idString))) {
                try {
                    item = await this.db.data.get(Number(idString));
                    if (item && item.collection !== collectionName) item = null; // Wrong collection
                } catch (e) {
                    console.warn('[Manager] Could not find item by local ID:', idString);
                }
            }

            // If still not found, try a broader search
            if (!item) {
                const candidates = await this.db.data.where({ collection: collectionName }).toArray();
                item = candidates.find(i => String(i._id || i.id) === idString);
            }

            if (!item) {
                console.warn('[Manager] Item not found for deletion:', idString);
                return;
            }

            const serverId = item._id;
            const localId = item.id;

            // Delete from local storage
            if (localId && !isNaN(Number(localId))) {
                await this.db.data.delete(Number(localId));
            } else {
                // Fallback: delete by collection and ID match
                await this.db.data.where({ collection: collectionName })
                    .filter(i => String(i._id || i.id) === idString).delete();
            }

            // Handle outbox operations
            if (serverId) {
                // Add delete operation for server sync
                await this.db.outbox.add({ action: 'DELETE', collection: collectionName, payload: { _id: serverId } });
            } else if (localId) {
                // Remove any pending operations for this local ID
                await this.db.outbox.where({ collection: collectionName })
                    .filter(o => o.payload.id && Number(o.payload.id) === Number(localId)).delete();
            }

            if (navigator.onLine && !this.isOfflineSimulated) this.syncOutbox();

        } catch (error) {
            console.error('[Manager] Failed to delete document:', error, id);
            throw error;
        }
    }

    /**
     * HAALT DATA ALLEEN UIT CACHE. 
     * Verversen moet nu handmatig of via refreshCache() aangeroepen worden.
     * Dit voorkomt de oneindige loop.
     */
    async getSmartCollection(collectionName) {
        return await this.db.data.where({ collection: collectionName }).toArray();
    }

    /**
     * VERVERS CACHE: Haalt serverdata en vergelijkt met outbox.
     */
    async refreshCache(collectionName) {
        if (!navigator.onLine || this.isOfflineSimulated) return;

        try {
            const freshData = await this.gateway.getCollection(collectionName);
            const outboxItems = await this.db.outbox.where({ collection: collectionName }).toArray();
            
            const deletedIds = new Set(outboxItems.filter(i => i.action === 'DELETE').map(i => i.payload._id));
            const pendingUpdates = new Set(outboxItems.filter(i => i.action !== 'DELETE').map(i => i.payload._id || i.payload.title));
            
            const filteredServerData = freshData.filter(doc => !deletedIds.has(doc._id));

            // Mapping voor ID-consistentie
            const localItems = await this.db.data.where({ collection: collectionName }).toArray();
            const idMap = new Map(); 
            localItems.forEach(item => { if (item._id) idMap.set(item._id, item.id); });

            const taggedData = filteredServerData.map(d => {
                const item = { ...d, collection: collectionName };
                if (idMap.has(d._id)) item.id = idMap.get(d._id);
                return item;
            });

            // Wis lokale items die echt weg zijn
            const serverIds = new Set(filteredServerData.map(d => d._id));
            await this.db.data.where({ collection: collectionName })
                .filter(doc => {
                    if (doc._id) return !serverIds.has(doc._id) && !pendingUpdates.has(doc._id);
                    return !pendingUpdates.has(doc.title);
                })
                .delete();
            
            await this.db.data.bulkPut(taggedData);

            // Meld aan UI dat er echt nieuwe data is (alleen als de cache veranderd is)
            if (this.onDataChanged) this.onDataChanged(collectionName);
        } catch (err) {
            console.warn(`[Manager] Refresh overgeslagen of mislukt`, err);
        }
    }

    async syncOutbox() {
        if (!navigator.onLine || this.isOfflineSimulated || this.isSyncing) return;
        this.isSyncing = true;
        
        try {
            let items = await this.db.outbox.orderBy('id').toArray();
            if (this.onSyncChange) this.onSyncChange(items.length);

            while (items.length > 0 && !this.isOfflineSimulated) {
                const item = items[0];
                try {
                    if (item.action === 'DELETE') {
                        await this.gateway.deleteDocument(item.collection, item.payload._id);
                    } else {
                        const payload = { ...item.payload };
                        const dexieId = payload.id;
                        delete payload.id; delete payload.collection;

                        const response = await this.gateway.saveDocument(item.collection, payload);
                        if (item.action === 'POST' && response && response._id) {
                            // Only update if we have a valid dexieId
                            if (dexieId && !isNaN(Number(dexieId))) {
                                try {
                                    await this.db.data.update(Number(dexieId), { _id: response._id });
                                } catch (e) {
                                    console.warn('[Manager] Failed to update _id after POST:', dexieId, e);
                                }
                            }
                        }
                    }
                    await this.db.outbox.delete(item.id);
                } catch (e) { break; }
                items = await this.db.outbox.orderBy('id').toArray();
                if (this.onSyncChange) this.onSyncChange(items.length);
            }
        } finally {
            this.isSyncing = false;
            // Na de sync verversen we de cache één keer goed
            if (this.onDataChanged) this.onDataChanged();
        }
    }
}