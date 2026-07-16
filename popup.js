document.addEventListener('DOMContentLoaded', function() {
    // DOM元素引用
    var queryInput = document.getElementById('query');
    var searchBtn = document.getElementById('btn-search');
    var topInput = document.getElementById('top-query');
    var companyEl = document.getElementById('card-company');
    var hostKvEl = document.getElementById('kv-host');
    var ipKvEl = document.getElementById('kv-ip');
    var legalEl = document.getElementById('card-legal');
    var capitalEl = document.getElementById('card-capital');
    var phoneEl = document.getElementById('card-phone');
    var emailEl = document.getElementById('card-email');
    var icpCompanyEl = document.getElementById('card-icp-company');
    var icpNumberEl = document.getElementById('card-icp-number');
    var icpStatusEl = document.getElementById('card-icp-status');
    var debugBox = document.getElementById('debug');
    var debugToggle = document.getElementById('debug-toggle');
    var themeBtn = document.getElementById('btn-theme');
    var settingsBtn = document.getElementById('btn-settings');
    
    // VT 页面的元素
    var vtScoreEl = document.getElementById('vt-score');
    var vtTotalEnginesEl = document.getElementById('vt-total-engines');
    var vtMaliciousCountEl = document.getElementById('vt-malicious-count');
    var vtStatusEl = document.getElementById('vt-status');
    var vtVendorsEl = document.getElementById('vt-vendors');
    var vtDebugBox = document.getElementById('vt-debug');
    var vtDebugToggle = document.getElementById('vt-debug-toggle');
    
    
    // 设置弹窗元素
    var settingsModal = document.getElementById('settings-modal');
    var closeSettingsBtn = document.getElementById('btn-close-settings');
    var vtApiKeyInput = document.getElementById('vt-api-key');
    var saveVtKeyBtn = document.getElementById('btn-save-vt-key');
    var clearVtKeyBtn = document.getElementById('btn-clear-vt-key');
    var vtApiKeyStatus = document.getElementById('vt-api-key-status');

    // 工具函数
    function setText(el, text) { 
        el.textContent = text || '-'; 
        el.classList.toggle('muted', !text); 
    }

    function setLoading(el, text) {
        el.textContent = text || '正在获取中...';
        el.classList.remove('muted');
    }
    
    function decodeUnicode(str) {
        try {
            if (!str) return '';
            return str.replace(/\\u([0-9a-fA-F]{4})/g, function(_, g) {
                try { 
                    return String.fromCharCode(parseInt(g, 16)); 
                } catch(e) { 
                    return _; 
                }
            });
        } catch(e) { 
            return str || ''; 
        }
    }
    
    function normalizeNumber(n) {
        if (typeof n === 'number') return n;
        if (!n) return NaN;
        var s = String(n).replace(/[,\s]/g, '');
        var m = s.match(/^-?\d*(?:\.\d+)?/);
        if (!m || !m[0]) return NaN;
        return parseFloat(m[0]);
    }
    
    function formatCapital(raw) {
        var s = decodeUnicode(raw || '').trim();
        if (!s) return '';
        
        var amount = normalizeNumber(s);
        
        if (/亿/.test(s)) {
            if (!isNaN(amount)) return (amount * 10000).toLocaleString('zh-CN') + ' 万元';
            return s;
        }
        
        if (/万/.test(s)) {
            if (!isNaN(amount)) return amount.toLocaleString('zh-CN') + ' 万元';
            return s.replace('万', '万元');
        }
        
        if (/元|人民币|CNY/i.test(s)) {
            if (!isNaN(amount)) return (amount / 10000).toLocaleString('zh-CN', {maximumFractionDigits: 2}) + ' 万元';
            return s + ' (万元)';
        }
        
        if (!isNaN(amount)) return amount.toLocaleString('zh-CN') + ' 万元';
        return s;
    }

    function getActiveHost(cb) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            try {
                var url = new URL((tabs[0] && tabs[0].url) || "");
                cb(url.hostname || '');
            } catch(e) { 
                cb(''); 
            }
        });
    }

    async function resolveTarget(host) {
        return await chrome.runtime.sendMessage({ type: 'resolveTarget', target: host });
    }

    async function queryICP(q) {
        return await chrome.runtime.sendMessage({ type: 'queryICP', query: q });
    }

    async function queryAizhan(q) {
        return await chrome.runtime.sendMessage({ type: 'queryAizhan', query: q });
    }

    async function queryVirusTotal(domain, apiKey) {
        return await chrome.runtime.sendMessage({ type: 'queryVirusTotal', domain: domain, apiKey });
    }

    function mergeDebugText(existingText, patch) {
        if (existingText && existingText.trim()) {
            try {
                return JSON.stringify({ ...JSON.parse(existingText), ...patch }, null, 2);
            } catch (e) {}
        }
        return JSON.stringify(patch, null, 2);
    }

    function showDebugPatch(patch) {
        if (!debugBox || !debugToggle) return;
        debugToggle.style.display = 'flex';
        debugBox.textContent = mergeDebugText(debugBox.textContent, patch);
    }


    function refresh() {
        var q = queryInput.value.trim();
        
        // 清空显示
        setText(hostKvEl, q);
        setLoading(ipKvEl);
        setLoading(companyEl);
        setLoading(legalEl);
        setLoading(capitalEl);
        setLoading(phoneEl);
        setLoading(emailEl);
        setLoading(icpNumberEl);
        setLoading(icpStatusEl);
        
        if (debugBox) { 
            debugBox.style.display = 'none'; 
            debugBox.textContent = ''; 
        }
        if (debugToggle) {
            debugToggle.style.display = 'none';
            debugToggle.classList.remove('expanded');
        }

        // 获取IP地址
        resolveTarget(q).then(function(r) {
            setText(ipKvEl, (r && r.ip) || '未获取到');
        }).catch(function() {
            setText(ipKvEl, '未获取到');
        });

        // 先获取备案信息，然后用主办单位名称去爱企查搜索详细信息
        queryAizhan(q).then(function(r) {
            if (r && r.source === 'aizhan') {
                if (r.company) { 
                    setText(icpCompanyEl, decodeUnicode(r.company)); 
                    // ??
                    setText(companyEl, decodeUnicode(r.company)); 
                    
                    // ??
                    queryICP(r.company).then(function(aiqichaResult) {
                        if (aiqichaResult.source === 'aiqicha') {
                            if (aiqichaResult.legal) { 
                                setText(legalEl, decodeUnicode(aiqichaResult.legal)); 
                            }
                            if (aiqichaResult.capital) { 
                                setText(capitalEl, formatCapital(aiqichaResult.capital)); 
                            }
                            if (aiqichaResult.phone) { 
                                setText(phoneEl, aiqichaResult.phone); 
                            }
                            if (aiqichaResult.email) { 
                                setText(emailEl, aiqichaResult.email); 
                            }
                            
                            // ??
                            if (aiqichaResult.debug) {
                                showDebugPatch({ aizhan: r.debug, [aiqichaResult.source]: aiqichaResult.debug });
                            }
                        }
                    }).catch(function(error) {
                        // ??
                        showDebugPatch({ aizhan: r.debug, aiqichaError: String(error) });
                    });
                }
                if (r.icpNumber) { 
                    setText(icpNumberEl, r.icpNumber); 
                }
                if (r.icpStatus) { 
                    setText(icpStatusEl, r.icpStatus); 
                }
                                     
                if (r.debug) {
                    showDebugPatch({ aizhan: r.debug });
                }
            }
        }).catch(function(error) {
            // ???
            showDebugPatch({ aizhanError: String(error) });
        });

        // ??VirusTotal?
        loadVirusTotalData(q);
    }

    // ???
    getActiveHost(function(host) {
        queryInput.value = host || '';
        if (queryInput && queryInput.style.display !== 'none') { 
        queryInput.select();
        }
        if (host) { 
            refresh(); 
        }
    });
    
    // 搜索按钮事件
    if (searchBtn) {
        searchBtn.addEventListener('click', function() {
            if (topInput && topInput.style.display === 'none') {
                topInput.style.display = 'block';
                searchBtn.style.display = 'none';
                topInput.value = queryInput.value;
                topInput.focus();
                topInput.select();
                return;
            }
            if (topInput) { 
                queryInput.value = topInput.value.trim(); 
            }
            refresh();
        });
    }
    
    // 顶部搜索输入框事件
    if (topInput) {
        topInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                queryInput.value = topInput.value.trim();
                refresh();
            } else if (e.key === 'Escape') {
                topInput.style.display = 'none';
                searchBtn.style.display = '';
            }
        });
        
        topInput.addEventListener('blur', function() {
            // 保持值同步但收起UI
            queryInput.value = topInput.value.trim();
            topInput.style.display = 'none';
            searchBtn.style.display = '';
        });
    }
    
    // 主输入框事件
    if (queryInput) { 
        queryInput.addEventListener('keydown', function(e) { 
            if (e.key === 'Enter') { 
                refresh(); 
            } 
        }); 
    }
    
    // 主题切换功能
    const themes = ['default', 'dark', 'tech', 'nature', 'dream', 'vibrant'];
    let currentThemeIndex = 0;
    
    // 从存储中恢复主题
    chrome.storage.local.get(['theme'], function(result) {
        if (result.theme) {
            const savedIndex = themes.indexOf(result.theme);
            if (savedIndex !== -1) {
                currentThemeIndex = savedIndex;
                applyTheme(result.theme);
            }
        }
    });
    
    function applyTheme(themeName) {
        // 移除所有主题类
        document.body.classList.remove('theme-dark', 'theme-tech', 'theme-nature', 'theme-dream', 'theme-vibrant');
        
        // 添加新主题类
        if (themeName !== 'default') {
            document.body.classList.add('theme-' + themeName);
        }
        
        // 保存到存储
        chrome.storage.local.set({theme: themeName});
    }
    
    // 主题切换按钮事件
    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            currentThemeIndex = (currentThemeIndex + 1) % themes.length;
            const newTheme = themes[currentThemeIndex];
            applyTheme(newTheme);
            
            // 更新按钮图标
            const icons = ['🎨', '🌙', '💻', '🌿', '✨', '🔥'];
            themeBtn.textContent = icons[currentThemeIndex];
        });
    }
    
    // 调试信息切换事件
    if (debugToggle) {
        debugToggle.addEventListener('click', function() {
            const isExpanded = debugToggle.classList.contains('expanded');
            if (isExpanded) {
                debugToggle.classList.remove('expanded');
                debugBox.style.display = 'none';
            } else {
                debugToggle.classList.add('expanded');
                debugBox.style.display = 'block';
            }
        });
    }

    // 标签页切换
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabButtons.forEach(function(button){
        button.addEventListener('click', function(){
            const target = this.getAttribute('data-tab');
            tabButtons.forEach(b=>b.classList.remove('active'));
            tabContents.forEach(c=>c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('tab-' + target).classList.add('active');
            
            
            if (target === 'security-check') {
                getActiveHost(function(host){ if (host) loadVirusTotalData(host); });
            }
        });
    });

    // 加载VT数据
    function loadVirusTotalData(domain){
        if (vtScoreEl) vtScoreEl.textContent = '...';
        if (vtTotalEnginesEl) vtTotalEnginesEl.textContent = '...';
        if (vtMaliciousCountEl) vtMaliciousCountEl.textContent = '...';
        if (vtStatusEl) vtStatusEl.textContent = '正在查询...';
        if (vtVendorsEl) vtVendorsEl.innerHTML = '<div class="loading">正在加载检测结果...</div>';

        chrome.storage.local.get(['vtApiKey'], function(result) {
            const apiKey = (result && result.vtApiKey) || '';
            if (!apiKey) {
                if (vtScoreEl) vtScoreEl.textContent = '-';
                if (vtTotalEnginesEl) vtTotalEnginesEl.textContent = '-';
                if (vtMaliciousCountEl) vtMaliciousCountEl.textContent = '-';
                if (vtStatusEl) vtStatusEl.textContent = '您还未配置VirusTotal API Key';
                if (vtVendorsEl) vtVendorsEl.innerHTML = '<div class="error">您还未配置VirusTotal API Key</div>';
                if (vtDebugToggle) vtDebugToggle.style.display = 'none';
                if (vtDebugBox) vtDebugBox.style.display = 'none';
                return;
            }

            queryVirusTotal(domain, apiKey).then(function(result){
                
                if (result && result.debug) {
                    if (vtDebugToggle) vtDebugToggle.style.display = 'flex';
                    if (vtDebugBox) vtDebugBox.textContent = JSON.stringify({ virustotal: result.debug }, null, 2);
                }
                if (result && result.source === 'virustotal') {
                    var mc = Number(result.maliciousCount||0);
                    var te = Number(result.totalEngines||0);
                    var score = te ? Math.round((1 - mc/te) * 100) : 100;
                    if (vtScoreEl) {
                        vtScoreEl.textContent = score + '%';
                        // ???
                        const scoreCircle = vtScoreEl.closest('.score-circle');
                        if (scoreCircle) {
                            if (score < 90) {
                                scoreCircle.style.background = 'linear-gradient(135deg, var(--error-color), #dc3545)'; // ??
                            } else if (score < 95) {
                                scoreCircle.style.background = 'linear-gradient(135deg, var(--warning-color), #ffc107)'; // ??
                            } else {
                                scoreCircle.style.background = 'linear-gradient(135deg, var(--success-color), #28a745)'; // ??
                            }
                        }
                    }
                    if (vtTotalEnginesEl) vtTotalEnginesEl.textContent = te || '-';
                    if (vtMaliciousCountEl) {
                        vtMaliciousCountEl.textContent = mc || '-';
                        // ??
                        if (mc > 0) {
                            vtMaliciousCountEl.style.color = 'var(--error-color)'; // ??
                        } else {
                            vtMaliciousCountEl.style.color = 'var(--text-primary)'; // ??
                        }
                    }
                    if (vtStatusEl) {
                        vtStatusEl.textContent = result.status || '-';
                        // ??
                        if (result.status === 'Malicious') {
                            vtStatusEl.style.color = 'var(--error-color)'; // ??
                        } else if (result.status === 'Clean') {
                            vtStatusEl.style.color = 'var(--success-color)'; // ??
                        } else {
                            vtStatusEl.style.color = 'var(--text-primary)'; // ??
                        }
                    }
                    if (vtVendorsEl) {
                        if (result.vendors && result.vendors.length) {
                            vtVendorsEl.innerHTML = result.vendors.map(function(v){
                                var cls, icon, displayText;
                                
                                // ??
                                
                                // ???
                                var resultLower = (v.result || '').toLowerCase();
                                
                                if (resultLower === 'clean') {
                                    cls = 'clean';
                                    icon = '?';
                                    displayText = 'Clean';
                                } else if (resultLower === 'malicious' || resultLower === 'malware' || resultLower === 'phishing') {
                                    cls = 'malicious';
                                    icon = '?';
                                    displayText = v.result; // ????
                                } else if (resultLower === 'unknown' || resultLower === 'unrated') {
                                    cls = 'unrated';
                                    icon = '?';
                                    displayText = 'Unrated';
                                } else {
                                    // ?????? Suspicious
                                    cls = 'suspicious';
                                    icon = '?';
                                    displayText = v.result;
                                }
                                
                                return '<div class="vendor-item"><span class="vendor-name">'+v.name+'</span><span class="vendor-result '+cls+'">'+icon+' '+displayText+'</span></div>';
                            }).join('');
                        } else {
                            vtVendorsEl.innerHTML = '<div class="no-data">暂无检测结果</div>';
                        }
                    }
                } else {
                    if (vtVendorsEl) vtVendorsEl.innerHTML = '<div class="error">未能获取VirusTotal数据</div>';
                }
            }).catch(function(err){
                if (vtScoreEl) vtScoreEl.textContent = '-';
                if (vtTotalEnginesEl) vtTotalEnginesEl.textContent = '-';
                if (vtMaliciousCountEl) vtMaliciousCountEl.textContent = '-';
                if (vtStatusEl) vtStatusEl.textContent = '加载失败';
                if (vtVendorsEl) vtVendorsEl.innerHTML = '<div class="error">请求失败：'+err+'</div>';
            });
        });
    }


    // VT 调试信息收起展开
    if (vtDebugToggle) {
        vtDebugToggle.addEventListener('click', function(){
            const open = vtDebugToggle.classList.contains('expanded');
            if (open) { vtDebugToggle.classList.remove('expanded'); vtDebugBox.style.display='none'; }
            else { vtDebugToggle.classList.add('expanded'); vtDebugBox.style.display='block'; }
        });
    }


    // 设置弹窗相关功能
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function(){
            settingsModal.style.display = 'block';
            loadApiKey();
        });
    }

    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', function(){
            settingsModal.style.display = 'none';
        });
    }

    // 点击弹窗外部关闭
    if (settingsModal) {
        settingsModal.addEventListener('click', function(e){
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });
    }

    // 保存API Key
    if (saveVtKeyBtn) {
        saveVtKeyBtn.addEventListener('click', function(){
            const apiKey = vtApiKeyInput.value.trim();
            if (apiKey) {
                chrome.storage.local.set({vtApiKey: apiKey}, function(){
                    vtApiKeyStatus.textContent = 'API Key 保存成功！';
                    vtApiKeyStatus.className = 'api-key-status set';
                    setTimeout(function(){
                        vtApiKeyStatus.textContent = 'API Key 已设置';
                        vtApiKeyStatus.className = 'api-key-status set';
                    }, 2000);
                });
            } else {
                vtApiKeyStatus.textContent = '请输入有效的API Key';
                vtApiKeyStatus.className = 'api-key-status error';
            }
        });
    }

    // 清除API Key
    if (clearVtKeyBtn) {
        clearVtKeyBtn.addEventListener('click', function(){
            chrome.storage.local.remove(['vtApiKey'], function(){
                vtApiKeyInput.value = '';
                vtApiKeyStatus.textContent = 'API Key 已清除';
                vtApiKeyStatus.className = 'api-key-status';
            });
        });
    }

    // 加载API Key
    function loadApiKey() {
        chrome.storage.local.get(['vtApiKey'], function(result){
            if (result.vtApiKey) {
                vtApiKeyInput.value = result.vtApiKey;
                vtApiKeyStatus.textContent = 'API Key 已设置';
                vtApiKeyStatus.className = 'api-key-status set';
            } else {
                vtApiKeyInput.value = '';
                vtApiKeyStatus.textContent = '未设置API Key';
                vtApiKeyStatus.className = 'api-key-status';
            }
        });
    }
});
