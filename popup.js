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

    // 工具函数
    function setText(el, text) { 
        el.textContent = text || '-'; 
        el.classList.toggle('muted', !text); 
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
        try {
            const result = await chrome.runtime.sendMessage({ type: 'queryAizhan', query: q });
            return result;
        } catch (error) {
            throw error;
        }
    }

    function appendList(parent, title, href, desc) {
        var item = document.createElement('div');
        item.className = 'list-item';
        
        var a = document.createElement('a');
        a.href = href || '#'; 
        a.target = '_blank'; 
        a.textContent = title || '';
        
        var p = document.createElement('div');
        p.className = 'muted';
        p.textContent = desc || '';
        
        item.appendChild(a); 
        item.appendChild(p); 
        parent.appendChild(item);
    }

    function refresh() {
        var q = queryInput.value.trim();
        
        // 清空显示
        setText(hostKvEl, q);
        setText(ipKvEl, '');
        setText(companyEl, '');
        setText(legalEl, '');
        setText(capitalEl, '');
        setText(phoneEl, '');
        setText(emailEl, '');
        setText(icpNumberEl, '');
        setText(icpStatusEl, '');
        
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
            setText(ipKvEl, r && r.ip); 
        });

        // 先获取备案信息，然后用主办单位名称去爱企查搜索详细信息
        queryAizhan(q).then(function(r) {
            if (r && r.source === 'aizhan') {
                if (r.company) { 
                    setText(icpCompanyEl, decodeUnicode(r.company)); 
                    // 同时设置资产归属的所属公司
                    setText(companyEl, decodeUnicode(r.company)); 
                    
                                            // 用主办单位名称去爱企查搜索详细信息
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
                            
                            // 合并调试信息
                            if (aiqichaResult.debug) { 
                                debugToggle.style.display = 'flex';
                                let currentDebug = debugBox.textContent;
                                
                                if (currentDebug && currentDebug.trim()) {
                                    try {
                                        let currentObj = JSON.parse(currentDebug);
                                        let mergedDebug = { ...currentObj, [aiqichaResult.source]: aiqichaResult.debug };
                                        debugBox.textContent = JSON.stringify(mergedDebug, null, 2);
                                    } catch(e) {
                                        debugBox.textContent = JSON.stringify({ aizhan: r.debug, [aiqichaResult.source]: aiqichaResult.debug }, null, 2);
                                    }
                                } else {
                                    debugBox.textContent = JSON.stringify({ aizhan: r.debug, [aiqichaResult.source]: aiqichaResult.debug }, null, 2);
                                }
                            }
                        }
                    });
                }
                if (r.icpNumber) { 
                    setText(icpNumberEl, r.icpNumber); 
                }
                if (r.icpStatus) { 
                    setText(icpStatusEl, r.icpStatus); 
                }
                                     
                if (r.debug) { 
                    debugToggle.style.display = 'flex';
                    // 合并调试信息
                    let currentDebug = debugBox.textContent;
                    
                    if (currentDebug && currentDebug.trim()) {
                        try {
                            let currentObj = JSON.parse(currentDebug);
                            let mergedDebug = { ...currentObj, aizhan: r.debug };
                            debugBox.textContent = JSON.stringify(mergedDebug, null, 2);
                        } catch(e) {
                            debugBox.textContent = JSON.stringify({ aizhan: r.debug }, null, 2);
                        }
                    } else {
                        debugBox.textContent = JSON.stringify({ aizhan: r.debug }, null, 2);
                    }
                }
            }
        }).catch(function(error) {
            // 即使出错也要显示调试信息
            debugToggle.style.display = 'flex';
            let currentDebug = debugBox.textContent;
            if (currentDebug && currentDebug.trim()) {
                try {
                    let currentObj = JSON.parse(currentDebug);
                    let mergedDebug = { ...currentObj, aizhanError: String(error) };
                    debugBox.textContent = JSON.stringify(mergedDebug, null, 2);
                } catch(e) {
                    debugBox.textContent = JSON.stringify({ aizhanError: String(error) }, null, 2);
                }
            } else {
                debugBox.textContent = JSON.stringify({ aizhanError: String(error) }, null, 2);
            }
        });
    }

    // 初始化：获取当前标签页的域名
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
});
