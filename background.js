async function safeFetch(input, init) {
    try {
        const res = await fetch(input, init);
        const text = await res.text();
        return { ok: res.ok, status: res.status, text: text };
    } catch(e) {
        return { ok: false, status: 0, text: String(e) };
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        if (msg && msg.type === 'resolveTarget') {
            const target = msg.target || '';
            let ip = '';
            
            if (target) {
                const r = await safeFetch('https://dns.google/resolve?name=' + encodeURIComponent(target) + '&type=A');
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
                            result.vendors = Object.entries(lastAnalysisResults).map(([name, data]) => ({
                                name: name,
                                result: data.result || 'Unknown'
                            })); // 显示所有厂商
                            
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
            
            try {
                // 从爱站网获取备案信息
                const aizhanUrl = 'https://www.aizhan.com/cha/' + encodeURIComponent(q);
                const rAizhan = await safeFetch(aizhanUrl, { 
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
                
                const html = rAizhan.text || '';
                
                function pick(reArr) {
                    for (const re of reArr) { 
                        const m = html.match(re); 
                        if (m && m[1]) return m[1].trim(); 
                    }
                    return '';
                }
                
                // 从爱站网提取备案信息 (基于实际HTML结构优化)
                let company = pick([
                    /名称:\s*<span[^>]*id="icp_name"[^>]*>([^<]{1,100})</,
                    /名称:\s*<span[^>]*>([^<]{1,100})</,
                    /<span[^>]*id="icp_name"[^>]*>([^<]{1,100})</,
                    /<span[^>]*id="icp_company"[^>]*>([^<]{1,100})</,
                    /备案信息[^<]*名称[^<]*>([^<]{1,100})</,
                    /名称[^<]*>([^<]{1,100})</,
                    /主办单位[^<]*>([^<]{1,100})</,
                    /备案主体[^<]*>([^<]{1,100})</,
                    /网站名称[^<]*>([^<]{1,100})</,
                    /公司名称[^<]*>([^<]{1,100})</,
                    /企业名称[^<]*>([^<]{1,100})</,
                    /TITLE信息[^<]*>([^<]{1,100})</
                ]);
                
                let icpNumber = pick([
                    /<a[^>]*id="icp_icp"[^>]*>([^<]{1,50})</,
                    /备案号[^<]*>([^<]{1,50})</,
                    /备案信息[^<]*备案号[^<]*>([^<]{1,50})</,
                    /([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][0-9A-Z]{4,10}ICP备[0-9]{4,8}号[^<]*)/,
                    /许可证号[^<]*>([^<]{1,50})</
                ]);
                
                let icpStatus = pick([
                    /<span[^>]*id="icp_type"[^>]*>([^<]{1,20})</,
                    /性质:\s*<span[^>]*>([^<]{1,20})</,
                    /性质[^<]*>([^<]{1,20})</,
                    /备案信息[^<]*性质[^<]*>([^<]{1,20})</,
                    /备案状态[^<]*>([^<]{1,20})</,
                    /状态[^<]*>([^<]{1,20})</
                ]);
                
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
                return;
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
                return;
                
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
            
            // 从爱企查获取公司信息
            
            try {
                // 从爱企查获取公司信息
                // 先访问首页获取cookies
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
                
                // 然后进行搜索
                const searchUrl = 'https://aiqicha.baidu.com/s?q=' + encodeURIComponent(q);
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
                const patterns = [
                    /href=\"(\/company_detail_[^\"?#]+)[^\"]*\"/,
                    /"href"\s*:\s*"(\/company_detail_[^"]+)"/,
                    /(\/company_detail_[a-zA-Z0-9_\-]+)\b/,
                    /href="([^"]*company_detail_[^"]*)"/,
                    /"url"\s*:\s*"([^"]*company_detail_[^"]*)"/,
                    /company_detail_[a-zA-Z0-9_\-]+/,
                    /href="([^"]*\/company\/[^"]*)"/,
                    /"url"\s*:\s*"([^"]*\/company\/[^"]*)"/,
                    /\/company\/[a-zA-Z0-9_\-]+/
                ];
                
                let detailPath = '';
                for (const re of patterns) { 
                    const m = html.match(re); 
                    if (m && m[1]) { 
                        detailPath = m[1]; 
                        break; 
                    } 
                }
                
                if (!detailPath) { 
                    // 尝试从搜索页面直接提取信息
                    function pickFromSearch(reArr) {
                        for (const re of reArr) { 
                            const m = html.match(re); 
                            if (m && m[1]) return m[1].trim(); 
                        }
                        return '';
                    }
                    
                    let legal = pickFromSearch([
                        /法定代表人[^<]*>([^<]{1,40})</i,
                        /法人代表[^<]*>([^<]{1,40})</i,
                        /法人[^<]*>([^<]{1,40})</i
                    ]);
                    
                    let capital = pickFromSearch([
                        /注册资本[^<]*>([^<]{1,60})</i,
                        /注册资金[^<]*>([^<]{1,60})</i
                    ]);
                    
                    let phone = pickFromSearch([
                        /电话[^<]*>([^<]{3,20})</i,
                        /联系电话[^<]*>([^<]{3,20})</i
                    ]);
                    
                    let email = pickFromSearch([
                        /邮箱[^<]*>([^<]{3,60})</i,
                        /电子邮箱[^<]*>([^<]{3,60})</i,
                        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
                    ]);
                    
                    if (legal || capital || phone || email) {
                        sendResponse({ 
                            source: 'aiqicha', 
                            url: searchUrl, 
                            company: q, 
                            legal, 
                            capital, 
                            phone, 
                            email, 
                            debug: {
                                searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                                searchStatus: rSearch.status,
                                extracted: {
                                    company: q,
                                    legal: legal,
                                    capital: capital,
                                    phone: phone,
                                    email: email
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
                            htmlSample: html.substring(0, 1000)
                        } 
                    }); 
                    return; 
                }
                
                const detailUrl = 'https://aiqicha.baidu.com' + detailPath;
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
                
                if (!rDetail.ok) { 
                    sendResponse({ 
                        source: 'aiqicha', 
                        url: detailUrl, 
                        error: 'detail_fetch_failed', 
                        debug: { 
                            searchUrl: { url: searchUrl, purpose: '搜索公司信息' }, 
                            searchStatus: rSearch.status, 
                            detailUrl: { url: detailUrl, purpose: '获取公司详细信息' }, 
                            detailStatus: rDetail.status
                        } 
                    }); 
                    return; 
                }
                
                const dh = rDetail.text || '';
                
                function pick(reArr) {
                    for (const re of reArr) { 
                        const m = dh.match(re); 
                        if (m && m[1]) return m[1].trim(); 
                    }
                    return '';
                }
                
                // 提取公司信息
                let company = pick([
                    /\"entName\"\s*:\s*\"([^\"]{1,80})\"/i,
                    /\"companyName\"\s*:\s*\"([^\"]{1,80})\"/i,
                    /<title>\s*([^<>{}]{1,80}?)\s*-\s*爱企查\s*<\/title>/i,
                    /公司名称[^<]*>([^<]{1,80})</i,
                    /企业名称[^<]*>([^<]{1,80})</i
                ]);
                
                let legal = pick([
                    /\"legalPersonName\"\s*:\s*\"([^\"]{1,40})\"/i,
                    /\"legalPerson\"\s*:\s*\"([^\"]{1,40})\"/i,
                    /法定代表人[^<]*>([^<]{1,40})</i,
                    /法人代表[^<]*>([^<]{1,40})</i,
                    /法人[^<]*>([^<]{1,40})</i
                ]);
                
                let capital = pick([
                    /\"regCapital\"\s*:\s*\"([^\"]{1,40})\"/i,
                    /\"registeredCapital\"\s*:\s*\"([^\"]{1,40})\"/i,
                    /注册资本[^<]*>([^<]{1,60})</i,
                    /注册资金[^<]*>([^<]{1,60})</i
                ]);
                
                let phone = pick([
                    /\"telephone\"\s*:\s*\"([^\"]{3,20})\"/i,
                    /电话[^<]*>([^<]{3,20})</i,
                    /联系电话[^<]*>([^<]{3,20})</i
                ]);
                
                let email = pick([
                    /\"email\"\s*:\s*\"([^\"]{3,60})\"/i,
                    /邮箱[^<]*>([^<]{3,60})</i,
                    /电子邮箱[^<]*>([^<]{3,60})</i,
                    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
                ]);
                
                sendResponse({ 
                    source: 'aiqicha', 
                    url: detailUrl, 
                    company, 
                    legal, 
                    capital, 
                    phone, 
                    email, 
                    debug: {
                        searchUrl: { url: searchUrl, purpose: '搜索公司信息' },
                        searchStatus: rSearch.status,
                        detailUrl: { url: detailUrl, purpose: '获取公司详细信息' },
                        detailStatus: rDetail.status,
                        extracted: {
                            company: company,
                            legal: legal,
                            capital: capital,
                            phone: phone,
                            email: email
                        },
                        detailHtmlSample: dh.substring(0, 1000)
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


