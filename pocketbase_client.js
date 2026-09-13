/**
 * PocketBase REST client for FinancePro collections.
 */

class PocketBaseClient {
    constructor(baseUrl, clientId) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.clientId = clientId;
    }

    _headers(json = false) {
        const headers = { 'x-client-id': this.clientId };
        if (json) headers['Content-Type'] = 'application/json';
        return headers;
    }

    _recordsUrl(collectionName, recordId = null) {
        let url = `${this.baseUrl}/api/collections/${collectionName}/records`;
        if (recordId) url += `/${recordId}`;
        return url;
    }

    _recordId(data) {
        return data._id || data.id || null;
    }

    _mapRecord(record) {
        if (!record || typeof record !== 'object') return record;
        const mapped = { ...record, _id: record.id, id: record.id };
        delete mapped.collectionId;
        delete mapped.collectionName;
        delete mapped.expand;
        delete mapped.client_id;
        return mapped;
    }

    _preparePayload(data) {
        const payload = { ...data };
        delete payload._id;
        delete payload.id;
        delete payload.collection;
        delete payload.created;
        delete payload.updated;
        payload.client_id = this.clientId;
        return payload;
    }

    async getCollection(name) {
        const url = `${this._recordsUrl(name)}?perPage=500&sort=-id`;
        const response = await fetch(url, { headers: this._headers() });
        if (!response.ok) {
            let detail = '';
            try {
                const err = await response.json();
                if (err.message) detail = `: ${err.message}`;
            } catch (_) { /* ignore */ }
            throw new Error(`Server error: ${response.status}${detail}`);
        }
        const body = await response.json();
        const items = Array.isArray(body) ? body : (body.items || []);
        return items.map((item) => this._mapRecord(item));
    }

    async saveDocument(name, data) {
        const recordId = this._recordId(data);
        const payload = this._preparePayload(data);
        const isUpdate = Boolean(recordId);
        const url = isUpdate ? this._recordsUrl(name, recordId) : this._recordsUrl(name);
        const response = await fetch(url, {
            method: isUpdate ? 'PATCH' : 'POST',
            headers: this._headers(true),
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Save error: ${response.status}`);
        const record = await response.json();
        return this._mapRecord(record);
    }

    async deleteDocument(name, id) {
        const recordId = id && typeof id === 'object' ? this._recordId(id) : id;
        if (!recordId) throw new Error('Delete error: missing record id');
        const response = await fetch(this._recordsUrl(name, recordId), {
            method: 'DELETE',
            headers: this._headers()
        });
        if (!response.ok) throw new Error(`Delete error: ${response.status}`);
        return true;
    }
}
