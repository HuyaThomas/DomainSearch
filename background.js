async function safeFetch(input, init) {
    try {
        const res = await fetch(input, init);
        const text = await res.text();
        return { ok: res.ok, status: res.status, text: text };
    } catch(e) {
        return { ok: false, status: 0, text: String(e) };
    }
}

function decodeHtml(text) {
    return String(text || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function stripTags(text) {
    return decodeHtml(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeCompanyName(name) {
    return stripTags(name)
        .toLowerCase()
        .replace(/[·•\s　、,，.。()（）【】\[\]{}<>]/g, '')
        .replace(/有限责任公司|股份有限公司|集团有限公司|有限公司|公司|集团/g, '');
}

function scoreCompanyMatch(query, candidateName, candidatePath) {
    const q = normalizeCompanyName(query);
    const c = normalizeCompanyName(candidateName);
    let score = 0;

    if (q && c) {
        if (q === c) score += 100;
        else if (c.includes(q) || q.includes(c)) score += 80;
        else {
            const qHead = q.slice(0, Math.min(q.length, 8));
            const cHead = c.slice(0, Math.min(c.length, 8));
            if (qHead && cHead && qHead === cHead) score += 35;
            if (q.length >= 4 && c.length >= 4 && q.slice(0, 4) === c.slice(0, 4)) score += 20;
        }
    }

    if (candidatePath) {
        if (/company_detail_/i.test(candidatePath)) score += 10;
        if (/\/company\//i.test(candidatePath)) score += 8;
    }

    return score;
}

function collectAiqichaCandidates(html, query) {
    const candidates = [];
    const seen = new Set();
    const source = String(html || '');

    function addCandidate(path, name, kind) {
        if (!path) return;
        const cleanPath = decodeHtml(path).trim();
        if (!cleanPath) return;
        if (seen.has(cleanPath)) return;
        seen.add(cleanPath);
        candidates.push({
            path: cleanPath,
            name: stripTags(name || ''),
            kind: kind || 'unknown',
            score: scoreCompanyMatch(query, name, cleanPath)
        });
    }

    const anchorRe = /<a[^>]*href="([^"]*(?:company_detail_|\/company\/)[^"]*)"[^>]*>([\s\S]{0,180}?)<\/a>/gi;
    let m;
    while ((m = anchorRe.exec(source))) {
        addCandidate(m[1], m[2], 'anchor');
    }

    const jsonNameFirstRe = /"(?:entName|companyName|name|title)"\s*:\s*"([^"]{1,120})"[\s\S]{0,220}?"(?:href|url)"\s*:\s*"([^"]*(?:company_detail_|\/company\/)[^"]+)"/gi;
    while ((m = jsonNameFirstRe.exec(source))) {
        addCandidate(m[2], m[1], 'json');
    }

    const jsonPathFirstRe = /"(?:href|url)"\s*:\s*"([^"]*(?:company_detail_|\/company\/)[^"]+)"[\s\S]{0,220}?"(?:entName|companyName|name|title)"\s*:\s*"([^"]{1,120})"/gi;
    while ((m = jsonPathFirstRe.exec(source))) {
        addCandidate(m[1], m[2], 'json');
    }

    const plainPathRe = /(\/(?:company_detail_[a-zA-Z0-9_\-]+|company\/[a-zA-Z0-9_\-]+))/gi;
    while ((m = plainPathRe.exec(source))) {
        const path = m[1];
        const windowStart = Math.max(0, m.index - 160);
        const windowEnd = Math.min(source.length, m.index + path.length + 220);
        const snippet = source.slice(windowStart, windowEnd);
        const nameMatch = snippet.match(/"(?:entName|companyName|name|title)"\s*:\s*"([^"]{1,120})"/i)
            || snippet.match(/title="([^"]{1,120})"/i)
            || snippet.match(/>([^<]{2,120})</);
        addCandidate(path, nameMatch && nameMatch[1], 'path');
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}

function extractAiqichaFields(html) {
    const source = String(html || '');

    function pick(reArr) {
        for (const re of reArr) {
            const m = source.match(re);
            if (m && m[1]) return stripTags(m[1]);
        }
        return '';
    }

    const company = pick([
        /"entName"\s*:\s*"([^"]{1,120})"/i,
        /"companyName"\s*:\s*"([^"]{1,120})"/i,
        /<title>\s*([^<>{}]{1,120}?)\s*-\s*爱企查\s*<\/title>/i,
        /公司名称[^<]*>([^<]{1,120})</i,
        /企业名称[^<]*>([^<]{1,120})</i
    ]);

    const legal = pick([
        /"legalPersonName"\s*:\s*"([^"]{1,80})"/i,
        /"legalPerson"\s*:\s*"([^"]{1,80})"/i,
        /法定代表人[^<]*>([^<]{1,80})</i,
        /法人代表[^<]*>([^<]{1,80})</i,
        /法人[^<]*>([^<]{1,80})</i
    ]);

    const capital = pick([
        /"regCapital"\s*:\s*"([^"]{1,80})"/i,
        /"registeredCapital"\s*:\s*"([^"]{1,80})"/i,
        /注册资本[^<]*>([^<]{1,80})</i,
        /注册资金[^<]*>([^<]{1,80})</i
    ]);

    const phone = pick([
        /"telephone"\s*:\s*"([^"]{3,40})"/i,
        /电话[^<]*>([^<]{3,40})</i,
        /联系电话[^<]*>([^<]{3,40})</i
    ]);

    const email = pick([
        /"email"\s*:\s*"([^"]{3,80})"/i,
        /邮箱[^<]*>([^<]{3,80})</i,
        /电子邮箱[^<]*>([^<]{3,80})</i,
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
    ]);

    return { company, legal, capital, phone, email };
}

function hasUsefulAiqichaData(fields) {
    if (!fields) return false;
    return !!(fields.company || fields.legal || fields.capital || fields.phone || fields.email);
}

function extractAiqichaPageData(html) {
    const source = String(html || '');
    const marker = 'window.pageData =';
    const idx = source.indexOf(marker);
    if (idx < 0) return null;

    let i = idx + marker.length;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length || (source[i] !== '{' && source[i] !== '[')) return null;

    const start = i;
    let depth = 0;
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (; i < source.length; i++) {
        const ch = source[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === stringQuote) {
                inString = false;
                stringQuote = '';
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringQuote = ch;
            continue;
        }

        if (ch === '{' || ch === '[') {
            depth++;
        } else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) {
                const jsonText = source.slice(start, i + 1);
                try {
                    return JSON.parse(jsonText);
                } catch (e) {
                    return null;
                }
            }
        }
    }

    return null;
}

function findAiqichaResultList(value, depth) {
    if (depth > 6 || value == null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return [];
        try {
            return findAiqichaResultList(JSON.parse(text), depth + 1);
        } catch (e) {
            return [];
        }
    }
    if (typeof value === 'object') {
        const keys = ['resultList', 'list', 'items', 'data', 'result'];
        for (const key of keys) {
            if (value[key] == null) continue;
            const found = findAiqichaResultList(value[key], depth + 1);
            if (found.length) return found;
        }
    }
    return [];
}

function scoreAiqichaSearchCandidate(normalizedQuery, name, item, index) {
    const normalizedName = normalizeCompanyName(name);
    let score = 0;

    if (normalizedQuery && normalizedName) {
        if (normalizedQuery === normalizedName) score += 120;
        else if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) score += 90;
        else {
            const qHead = normalizedQuery.slice(0, Math.min(8, normalizedQuery.length));
            const nHead = normalizedName.slice(0, Math.min(8, normalizedName.length));
            if (qHead && nHead && qHead === nHead) score += 40;
            if (normalizedQuery.slice(0, 4) === normalizedName.slice(0, 4)) score += 20;
        }
    }

    if ((item.openStatus || '') === '??') score += 5;
    if (item.legalPerson) score += 3;
    if (item.titleLegal) score += 2;
    if (item.regCap) score += 3;
    if (item.telephone || item.phoneinfoCount) score += 2;
    if (item.email || item.emailinfoCount) score += 2;
    score += Math.max(0, 20 - index);
    return score;
}

function normalizeAiqichaSearchItem(item, index, normalizedQuery) {
    const name = stripTags(item.titleName || item.entName || item.companyName || item.name || '');
    return {
        index: index,
        pid: item.pid || '',
        name: name,
        score: scoreAiqichaSearchCandidate(normalizedQuery, name, item, index),
        item: item,
        fields: {
            company: name,
            legal: stripTags(item.legalPerson || item.titleLegal || ''),
            capital: stripTags(item.regCap || ''),
            phone: stripTags(item.telephone || (item.phoneinfo && item.phoneinfo[0] && item.phoneinfo[0].phone) || ''),
            email: stripTags(item.email || (item.emailinfo && item.emailinfo[0] && item.emailinfo[0].email) || '')
        }
    };
}

function buildAiqichaSearchResultFromPageData(pageData, query, sourceLabel) {
    const normalizedQuery = normalizeCompanyName(query);
    const resultList = findAiqichaResultList(pageData, 0);
    const parsedCandidates = Array.isArray(resultList)
        ? resultList.map((item, index) => normalizeAiqichaSearchItem(item, index, normalizedQuery)).filter(x => x.name)
        : [];
    parsedCandidates.sort((a, b) => b.score - a.score);

    if (!parsedCandidates.length) return null;

    const best = parsedCandidates[0];
    return {
        pageData: pageData,
        resultCount: parsedCandidates.length,
        selected: {
            index: best.index,
            pid: best.pid,
            name: best.name,
            score: best.score,
            source: sourceLabel
        },
        fields: best.fields,
        sample: best.item,
        candidates: parsedCandidates.slice(0, 5)
    };
}

function extractAiqichaSearchResult(input, query) {
    const isStringInput = typeof input === 'string';
    const source = isStringInput ? String(input || '') : '';
    const pageData = isStringInput ? extractAiqichaPageData(source) : input;
    const parsedResult = buildAiqichaSearchResultFromPageData(pageData, query, isStringInput ? 'parsed-list' : 'tab-pageData');

    if (parsedResult) return parsedResult;
    if (!isStringInput) return null;

    const normalizedQuery = normalizeCompanyName(query);

    function extractWindowValue(windowText, patterns) {
        for (const re of patterns) {
            const m = windowText.match(re);
            if (m && m[1]) return stripTags(m[1]);
        }
        return '';
    }

    const titleRe = /"(?:titleName|entName|companyName)"\s*:\s*"([^"]{1,200})"/gi;
    const rawCandidates = [];
    const seen = new Set();
    let m;
    let guard = 0;
    while ((m = titleRe.exec(source)) && guard < 40) {
        guard++;
        const name = stripTags(m[1]);
        const key = normalizeCompanyName(name) || name;
        if (!name || seen.has(key)) continue;
        seen.add(key);

        const windowStart = Math.max(0, m.index - 260);
        const windowEnd = Math.min(source.length, m.index + 6000);
        const windowText = source.slice(windowStart, windowEnd);
        const legal = extractWindowValue(windowText, [
            /"legalPerson"\s*:\s*"([^"]{1,80})"/i,
            /"titleLegal"\s*:\s*"([^"]{1,80})"/i,
            /\u6cd5\u5b9a\u4ee3\u8868\u4eba[^<]*>([^<]{1,80})</i,
            /\u6cd5\u4eba\u4ee3\u8868[^<]*>([^<]{1,80})</i,
            /\u6cd5\u4eba[^<]*>([^<]{1,80})</i
        ]);
        const capital = extractWindowValue(windowText, [
            /"regCap"\s*:\s*"([^"]{1,80})"/i,
            /"registeredCapital"\s*:\s*"([^"]{1,80})"/i,
            /\u6ce8\u518c\u8d44\u672c[^<]*>([^<]{1,80})</i,
            /\u6ce8\u518c\u8d44\u91d1[^<]*>([^<]{1,80})</i
        ]);
        const phone = extractWindowValue(windowText, [
            /"telephone"\s*:\s*"([^"]{3,40})"/i,
            /\u7535\u8bdd[^<]*>([^<]{3,40})</i,
            /\u8054\u7cfb\u7535\u8bdd[^<]*>([^<]{3,40})</i
        ]);
        const email = extractWindowValue(windowText, [
            /"email"\s*:\s*"([^"]{3,80})"/i,
            /\u90ae\u7bb1[^<]*>([^<]{3,80})</i,
            /\u7535\u5b50\u90ae\u7bb1[^<]*>([^<]{3,80})</i,
            /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
        ]);
        const pidMatch = windowText.match(/"pid"\s*:\s*"([^"]{5,})"/i);
        const regNoMatch = windowText.match(/"regNo"\s*:\s*"([^"]{5,})"/i);

        rawCandidates.push({
            index: rawCandidates.length,
            pid: pidMatch ? pidMatch[1] : '',
            regNo: regNoMatch ? regNoMatch[1] : '',
            name: name,
            score: scoreAiqichaSearchCandidate(normalizedQuery, name, { legalPerson: legal, titleLegal: legal, regCap: capital, telephone: phone, email: email }, rawCandidates.length),
            fields: {
                company: name,
                legal: legal,
                capital: capital,
                phone: phone,
                email: email
            },
            sample: windowText.slice(0, 1200)
        });
    }

    rawCandidates.sort((a, b) => b.score - a.score);
    if (rawCandidates.length) {
        const best = rawCandidates[0];
        return {
            pageData: pageData,
            resultCount: rawCandidates.length,
            selected: {
                index: best.index,
                pid: best.pid,
                regNo: best.regNo,
                name: best.name,
                score: best.score,
                source: 'raw-window'
            },
            fields: best.fields,
            sample: best.sample,
            candidates: rawCandidates.slice(0, 5)
        };
    }

    return null;
}

async function captureAiqichaSnapshot(url) {
    return await new Promise((resolve) => {
        chrome.tabs.create({ url: url, active: false }, (tab) => {
            if (!tab || !tab.id) { resolve(null); return; }
            const tabId = tab.id;
            let finished = false;
            let timer = null;

            const finish = (payload) => {
                if (finished) return;
                finished = true;
                if (timer) clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                try { chrome.tabs.remove(tabId); } catch (e) {}
                resolve(payload);
            };

            const readPage = () => {
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => ({
                        href: location.href || '',
                        title: document.title || '',
                        pageData: window.pageData || null,
                        html: document.documentElement ? document.documentElement.outerHTML : ''
                    })
                }, (results) => {
                    if (chrome.runtime.lastError) { finish(null); return; }
                    const data = results && results[0] && results[0].result ? results[0].result : null;
                    finish(data);
                });
            };

            const listener = (tid, changeInfo) => {
                if (tid === tabId && changeInfo.status === 'complete') {
                    setTimeout(readPage, 1200);
                }
            };

            chrome.tabs.onUpdated.addListener(listener);
            timer = setTimeout(readPage, 15000);
        });
    });
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (msg && msg.type === 'resolveTarget') {
            const target = msg.target || '';
            let ip = '';
            
            if (target) {
                const r = await safeFetch('https://223.5.5.5/resolve?name=' + encodeURIComponent(target) + '&type=A');
                if (r.ok) {
                    try {
                        const j = JSON.parse(r.text);
                        const ans = (j && j.Answer) || [];
                        const a = ans.find(x => x.type === 1) || ans[0];
                        if (a) { 
                            ip = a.data; 
                        }
                    } catch(e) {
                        // DNS解析失败，保持ip为空
                    }
                }
            }
            
            sendResponse({ ip: ip });
            return;
        }

        if (msg && msg.type === 'queryVirusTotal') {
            const domain = msg.domain || '';
            const apiKey = msg.apiKey || '';
            
            try {
                let result = { source: 'virustotal', domain: domain };
                let debug = {
                    domain: domain,
                    apiKeyProvided: !!apiKey,
                    apiUsed: false,
                    apiStatus: 0,
                    apiResponseLength: 0,
                    apiResponseSample: '',
                    htmlLength: 0,
                    htmlSample: '',
                    error: null
                };
                
                // 优先使用API
                if (apiKey) {
                    const apiUrl = `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(domain)}`;
                    const apiRes = await safeFetch(apiUrl, {
                        headers: {
                            'x-apikey': apiKey,
                            'Accept': 'application/json'
                        }
                    });
                    
                    debug.apiUsed = true;
                    debug.apiStatus = apiRes.status;
                    debug.apiResponseLength = apiRes.text ? apiRes.text.length : 0;
                    debug.apiResponseSample = apiRes.text ? apiRes.text.substring(0, 500) : '';
                    
                    if (apiRes.ok && apiRes.text) {
                        try {
                            const apiData = JSON.parse(apiRes.text);
                            const data = apiData.data || {};
                            const attributes = data.attributes || {};
                            const lastAnalysisStats = attributes.last_analysis_stats || {};
                            const whois = attributes.whois || '';
                            
                            result.maliciousCount = lastAnalysisStats.malicious || 0;
                            result.totalEngines = (lastAnalysisStats.malicious || 0) + (lastAnalysisStats.undetected || 0) + (lastAnalysisStats.harmless || 0);
                            result.status = result.maliciousCount > 0 ? 'Malicious' : 'Clean';
                            
                            // 提取注册商信息
                            const registrarMatch = whois.match(/Registrar:\s*([^\n\r]+)/i);
                            if (registrarMatch) {
                                result.registrar = registrarMatch[1].trim();
                            }
                            
                            // 提取创建时间
                            const creationMatch = whois.match(/Creation Date:\s*([^\n\r]+)/i);
                            if (creationMatch) {
                                result.creationDate = creationMatch[1].trim();
                            }
                            
                            // 最后分析时间
                            if (attributes.last_analysis_date) {
                                result.lastAnalysis = new Date(attributes.last_analysis_date * 1000).toLocaleString();
                            }
                            
                            // 提取厂商检测结果
                            const lastAnalysisResults = attributes.last_analysis_results || {};
                            const allVendors = Object.entries(lastAnalysisResults).map(([name, data]) => ({
                                name: name,
                                result: data.result || 'Unknown'
                            }));
                            
                            // 按优先级排序：Malicious/Malware/Phishing > Clean > Unknown/Unrated
                            allVendors.sort((a, b) => {
                                const getPriority = (result) => {
                                    const resultLower = (result || '').toLowerCase();
                                    if (resultLower === 'malicious' || resultLower === 'malware' || resultLower === 'phishing') return 1;
                                    if (resultLower === 'clean') return 2;
                                    return 3; // Unknown, Unrated, 其他
                                };
                                return getPriority(a.result) - getPriority(b.result);
                            });
                            
                            result.vendors = allVendors; // 显示所有厂商
                            
                            result.debug = debug;
                            sendResponse(result);
                            return;
                        } catch (parseError) {
                            debug.error = 'API JSON parse error: ' + parseError.message;
                        }
                    }
                }
                
                // API失败或未提供API Key，回退到HTML解析
                const vtUrl = `https://www.virustotal.com/gui/domain/${encodeURIComponent(domain)}`;
                const rVt = await safeFetch(vtUrl, {
                    credentials: 'include',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': 'https://www.virustotal.com/'
                    }
                });
                
                debug.htmlLength = rVt.text ? rVt.text.length : 0;
                debug.htmlSample = rVt.text ? rVt.text.substring(0, 500) : '';
                
                if (rVt.ok && rVt.text) {
                    const html = rVt.text;
                    
                    // 尝试从HTML中提取数据
                    const maliciousMatch = html.match(/"malicious":\s*(\d+)/);
                    const totalMatch = html.match(/"total":\s*(\d+)/);
                    
                    if (maliciousMatch && totalMatch) {
                        result.maliciousCount = parseInt(maliciousMatch[1]);
                        result.totalEngines = parseInt(totalMatch[1]);
                        result.status = result.maliciousCount > 0 ? 'Malicious' : 'Clean';
                    }
                }
                
                result.debug = debug;
                sendResponse(result);
                return;
                
            } catch (error) {
                sendResponse({ 
                    source: 'virustotal', 
                    domain: domain, 
                    error: String(error),
                    debug: { error: String(error) }
                });
                return;
            }
        }

        if (msg && msg.type === 'queryAizhan') {
            const q = msg.query || '';
            const isRetry = msg.isRetry || false;
            
            try {
                const aizhanUrl = 'https://www.aizhan.com/cha/' + encodeURIComponent(q);
                let rAizhan = await safeFetch(aizhanUrl, { 
                    credentials: 'include',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': 'https://www.aizhan.com/'
                    }
                });
                
                if (!rAizhan.ok) { 
                    sendResponse({ 
                        source: 'aizhan', 
                        url: aizhanUrl, 
                        error: 'fetch_failed', 
                        debug: { 
                            aizhanUrl, 
                            aizhanStatus: rAizhan.status,
                            purpose: '获取备案信息'
                        } 
                    }); 
                    return; 
                }
                
                let html = rAizhan.text || '';
                
                function pick(reArr, text) {
                    text = text || html;
                    for (const re of reArr) { 
                        const m = text.match(re); 
                        if (m && m[1]) return m[1].trim(); 
                    }
                    return '';
                }
                
                // 仅从明确节点提取主办单位，避免误抓其他标签文本
                let company = pick([
                    /<span[^>]*id="icp_company"[^>]*>([^<]{1,100})</
                ]);
                
                // 如果提取失败且不是重试，尝试通过后台标签页访问以建立会话
                if (!company && !isRetry) {
                    // 创建后台标签页访问目标URL
                    await new Promise(resolve => {
                        chrome.tabs.create({ url: aizhanUrl, active: false }, (tab) => {
                            if (!tab) { resolve(); return; }
                            const tabId = tab.id;
                            let finished = false;
                            
                            // 清理函数
                            const cleanup = () => {
                                if (finished) return;
                                finished = true;
                                chrome.tabs.onUpdated.removeListener(listener);
                                chrome.tabs.remove(tabId).catch(() => {});
                                resolve();
                            };

                            // 超时保护 (8秒)
                            setTimeout(cleanup, 8000);

                            const listener = (tid, changeInfo) => {
                                if (tid === tabId && changeInfo.status === 'complete') {
                                    // 稍微等待一下JS执行和Cookie写入
                                    setTimeout(cleanup, 2000);
                                }
                            };
                            chrome.tabs.onUpdated.addListener(listener);
                        });
                    });
                    
                    // 重试获取
                    rAizhan = await safeFetch(aizhanUrl, { 
                        credentials: 'include',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': 'https://www.aizhan.com/'
                        }
                    });
                    html = rAizhan.text || '';
                    
                    // 再次提取
                    company = pick([
                        /<span[^>]*id="icp_company"[^>]*>([^<]{1,100})</
                    ], html);
                }

                let icpNumber = pick([
                    /<a[^>]*id="icp_icp"[^>]*>([^<]{1,50})</,
                    /备案号[^<]*>([^<]{1,50})</,
                    /备案信息[^<]*备案号[^<]*>([^<]{1,50})</,
                    /([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][0-9A-Z]{4,10}ICP备[0-9]{4,8}号[^<]*)/,
                    /许可证号[^<]*>([^<]{1,50})</
                ], html);
                
                let icpStatus = pick([
                    /<span[^>]*id="icp_type"[^>]*>([^<]{1,20})</,
                    /性质:\s*<span[^>]*>([^<]{1,20})</,
                    /性质[^<]*>([^<]{1,20})</,
                    /备案信息[^<]*性质[^<]*>([^<]{1,20})</,
                    /备案状态[^<]*>([^<]{1,20})</,
                    /状态[^<]*>([^<]{1,20})</
                ], html);
                
                sendResponse({ 
                    source: 'aizhan', 
                    url: aizhanUrl, 
                    company, 
                    icpNumber, 
                    icpStatus, 
                    debug: {
                        aizhanUrl, 
                        aizhanStatus: rAizhan.status,
                        purpose: '获取备案信息',
                        extracted: {
                            company: company,
                            icpNumber: icpNumber,
                            icpStatus: icpStatus
                        }
                    } 
                });
            } catch(e) { 
                sendResponse({ 
                    source: 'aizhan', 
                    url: '', 
                    error: String(e),
                    debug: {
                        purpose: '获取备案信息',
                        error: String(e)
                    }
                }); 
                return; 
            }
        }

        if (msg && msg.type === 'queryICP') {
            const q = msg.query || '';

            try {
                const homeUrl = 'https://aiqicha.baidu.com/';
                await safeFetch(homeUrl, { 
                    credentials: 'include',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br'
                    }
                });

                const searchUrl = 'https://aiqicha.baidu.com/s?q=' + encodeURIComponent(q);
                const snapshot = await captureAiqichaSnapshot(searchUrl);
                if (snapshot) {
                    const aiqichaSnapshotHit = extractAiqichaSearchResult(snapshot.pageData || snapshot.html || snapshot.source || '', q);
                    if (aiqichaSnapshotHit && hasUsefulAiqichaData(aiqichaSnapshotHit.fields)) {
                        sendResponse({
                            source: 'aiqicha',
                            url: searchUrl,
                            company: aiqichaSnapshotHit.fields.company || q,
                            legal: aiqichaSnapshotHit.fields.legal,
                            capital: aiqichaSnapshotHit.fields.capital,
                            phone: aiqichaSnapshotHit.fields.phone,
                            email: aiqichaSnapshotHit.fields.email,
                            debug: {
                                searchUrl: { url: searchUrl, purpose: 'search company info' },
                                searchStatus: 200,
                                selection: {
                                    method: aiqichaSnapshotHit.selected.source,
                                    candidateCount: aiqichaSnapshotHit.resultCount,
                                    chosenIndex: aiqichaSnapshotHit.selected.index,
                                    chosenPid: aiqichaSnapshotHit.selected.pid,
                                    chosenName: aiqichaSnapshotHit.selected.name,
                                    chosenScore: aiqichaSnapshotHit.selected.score
                                },
                                extracted: aiqichaSnapshotHit.fields,
                                selectedSample: aiqichaSnapshotHit.sample,
                                snapshot: {
                                    href: snapshot.href || '',
                                    title: snapshot.title || ''
                                },
                                htmlSample: String(snapshot.html || '').substring(0, 1000)
                            }
                        });
                        return;
                    }
                }

                const rSearch = await safeFetch(searchUrl, { 
                    credentials: 'include',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': 'https://aiqicha.baidu.com/'
                    }
                });

                if (!rSearch.ok) { 
                    sendResponse({ 
                        source: 'aiqicha', 
                        url: searchUrl, 
                        error: 'search_failed', 
                        debug: { 
                            searchUrl: { url: searchUrl, purpose: '搜索公司信息' }, 
                            searchStatus: rSearch.status
                        } 
                    }); 
                    return; 
                }

                const html = rSearch.text || '';
                const searchHit = extractAiqichaSearchResult(html, q);
                const searchExtracted = extractAiqichaFields(html);

                if (searchHit && hasUsefulAiqichaData(searchHit.fields)) {
                    sendResponse({
                        source: 'aiqicha',
                        url: searchUrl,
                        company: searchHit.fields.company || q,
                        legal: searchHit.fields.legal,
                        capital: searchHit.fields.capital,
                        phone: searchHit.fields.phone,
                        email: searchHit.fields.email,
                        debug: {
                            searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                            searchStatus: rSearch.status,
                            selection: {
                                method: 'pageData-resultList',
                                candidateCount: searchHit.resultCount,
                                chosenIndex: searchHit.selected.index,
                                chosenPid: searchHit.selected.pid,
                                chosenName: searchHit.selected.name,
                                chosenScore: searchHit.selected.score
                            },
                            extracted: searchHit.fields,
                            selectedSample: searchHit.sample,
                            htmlSample: html.substring(0, 1000)
                        }
                    });
                    return;
                }

                const candidates = collectAiqichaCandidates(html, q);

                if (!candidates.length) {
                    if (hasUsefulAiqichaData(searchExtracted)) {
                        sendResponse({
                            source: 'aiqicha',
                            url: searchUrl,
                            company: searchExtracted.company || q,
                            legal: searchExtracted.legal,
                            capital: searchExtracted.capital,
                            phone: searchExtracted.phone,
                            email: searchExtracted.email,
                            debug: {
                                searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                                searchStatus: rSearch.status,
                                selection: { method: 'search-page-fallback', candidateCount: 0 },
                                extracted: {
                                    company: searchExtracted.company || q,
                                    legal: searchExtracted.legal,
                                    capital: searchExtracted.capital,
                                    phone: searchExtracted.phone,
                                    email: searchExtracted.email
                                },
                                htmlSample: html.substring(0, 1000)
                            }
                        });
                        return;
                    }

                    sendResponse({ 
                        source: 'aiqicha', 
                        url: searchUrl, 
                        error: 'detail_link_not_found', 
                        debug: { 
                            searchUrl: { url: searchUrl, purpose: '搜索公司信息' }, 
                            searchStatus: rSearch.status,
                            selection: { method: 'search-page', candidateCount: 0 },
                            htmlSample: html.substring(0, 1000)
                        } 
                    }); 
                    return; 
                }

                const tried = [];
                const maxAttempts = Math.min(candidates.length, 5);
                for (let i = 0; i < maxAttempts; i++) {
                    const candidate = candidates[i];
                    const detailUrl = 'https://aiqicha.baidu.com' + candidate.path;
                    const rDetail = await safeFetch(detailUrl, { 
                        credentials: 'include',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Referer': searchUrl
                        }
                    });

                    const detailHtml = rDetail.text || '';
                    const extracted = extractAiqichaFields(detailHtml);
                    tried.push({
                        path: candidate.path,
                        name: candidate.name,
                        score: candidate.score,
                        status: rDetail.status,
                        ok: rDetail.ok,
                        htmlSample: detailHtml.substring(0, 1000),
                        extracted: extracted
                    });

                    if (rDetail.ok && hasUsefulAiqichaData(extracted)) {
                        sendResponse({ 
                            source: 'aiqicha', 
                            url: detailUrl, 
                            company: extracted.company || candidate.name || q, 
                            legal: extracted.legal, 
                            capital: extracted.capital, 
                            phone: extracted.phone, 
                            email: extracted.email, 
                            debug: {
                                searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                                searchStatus: rSearch.status,
                                selection: {
                                    method: 'candidate-detail',
                                    candidateCount: candidates.length,
                                    chosenIndex: i,
                                    chosenPath: candidate.path,
                                    chosenName: candidate.name,
                                    chosenScore: candidate.score
                                },
                                candidates: candidates.slice(0, 5),
                                tried: tried,
                                detailUrl: { url: detailUrl, purpose: '获取公司详细信息' },
                                detailStatus: rDetail.status,
                                extracted: {
                                    company: extracted.company || candidate.name || q,
                                    legal: extracted.legal,
                                    capital: extracted.capital,
                                    phone: extracted.phone,
                                    email: extracted.email
                                },
                                detailHtmlSample: detailHtml.substring(0, 1000)
                            } 
                        });
                        return;
                    }
                }

                const bestCandidate = candidates[0];
                const fallbackDetailUrl = 'https://aiqicha.baidu.com' + bestCandidate.path;
                const fallbackExtracted = hasUsefulAiqichaData(searchExtracted)
                    ? searchExtracted
                    : (tried.length ? tried[tried.length - 1].extracted : searchExtracted);
                sendResponse({
                    source: 'aiqicha',
                    url: fallbackDetailUrl,
                    company: fallbackExtracted.company || bestCandidate.name || q,
                    legal: fallbackExtracted.legal,
                    capital: fallbackExtracted.capital,
                    phone: fallbackExtracted.phone,
                    email: fallbackExtracted.email,
                    debug: {
                        searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                        searchStatus: rSearch.status,
                        selection: {
                            method: 'candidate-detail-fallback',
                            candidateCount: candidates.length,
                            bestPath: bestCandidate.path,
                            bestName: bestCandidate.name,
                            bestScore: bestCandidate.score
                        },
                        candidates: candidates.slice(0, 5),
                        tried: tried,
                        detailUrl: { url: fallbackDetailUrl, purpose: '获取公司详细信息' },
                        detailStatus: tried.length ? tried[tried.length - 1].status : 0,
                        extracted: {
                            company: fallbackExtracted.company || bestCandidate.name || q,
                            legal: fallbackExtracted.legal,
                            capital: fallbackExtracted.capital,
                            phone: fallbackExtracted.phone,
                            email: fallbackExtracted.email
                        },
                        detailHtmlSample: tried.length ? tried[tried.length - 1].htmlSample : html.substring(0, 1000)
                    }
                });
                return;

            } catch(e) { 
                sendResponse({ 
                    source: 'aiqicha', 
                    url: '', 
                    error: String(e),
                    debug: {
                        purpose: '获取公司信息',
                        error: String(e)
                    }
                }); 
                return; 
            }
        }

        sendResponse({});
    })();
    return true;
});

