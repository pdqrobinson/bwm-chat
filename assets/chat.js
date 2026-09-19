/* BWM Client Chat 2.0 - thin WordPress client for Command Center */
(function () {
    'use strict';
    if (!window.bwmChat || !window.bwmChat.isLoggedIn) return;

    const config = window.bwmChat;
    const widget = document.getElementById('bwm-chat-widget');
    if (!widget) return;

    document.documentElement.style.setProperty('--bwm-color', config.primaryColor || '#2563eb');

    const toggle = document.getElementById('bwm-chat-toggle');
    const panel = document.getElementById('bwm-chat-panel');
    const messages = document.getElementById('bwm-chat-messages');
    const input = document.getElementById('bwm-chat-input');
    const sendBtn = document.getElementById('bwm-chat-send');
    const usageCount = document.getElementById('bwm-usage-count');
    const iconOpen = toggle.querySelector('.bwm-chat-icon');
    const iconClose = toggle.querySelector('.bwm-chat-close');
    const selectBtn = document.getElementById('bwm-chat-select-element');
    const selectionChip = document.getElementById('bwm-chat-selection');
    const selectionLabel = document.getElementById('bwm-chat-selection-label');
    const clearSelectionBtn = document.getElementById('bwm-chat-clear-selection');

    let isOpen = config.openByDefault === true || config.openByDefault === '1' || config.openByDefault === 1;
    let isLoading = false;
    let selecting = false;
    let selectedElement = null;
    let hoverTarget = null;

    function getSessionKey() {
        const storageKey = 'bwm-chat-session:' + window.location.origin + ':' + String(config.userId || 'user');
        try {
            const existing = window.localStorage.getItem(storageKey);
            if (existing && /^[A-Za-z0-9._-]{8,128}$/.test(existing)) return existing;
        } catch (_) {}
        const random = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        const created = ('bwm.' + random).slice(0, 128);
        try { window.localStorage.setItem(storageKey, created); } catch (_) {}
        return created;
    }

    const sessionKey = getSessionKey();

    function escapeCss(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^A-Za-z0-9_-]/g, '\\$&');
    }

    function cleanClasses(el) {
        return Array.from(el.classList || [])
            .filter(name => /^[A-Za-z0-9_-]{1,80}$/.test(name))
            .filter(name => !name.startsWith('bwm-'))
            .slice(0, 10);
    }

    function selectorFor(el) {
        if (!(el instanceof Element)) return '';
        if (el.id) return '#' + escapeCss(el.id);
        const parts = [];
        let current = el;
        for (let depth = 0; current && current !== document.body && depth < 5; depth++) {
            let part = current.tagName.toLowerCase();
            const classes = cleanClasses(current).slice(0, 2);
            if (classes.length) part += '.' + classes.map(escapeCss).join('.');
            const parent = current.parentElement;
            if (parent) {
                const sameTag = Array.from(parent.children).filter(child => child.tagName === current.tagName);
                if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')';
            }
            parts.unshift(part);
            current = parent;
        }
        return parts.join(' > ').slice(0, 500);
    }

    function safeAttributes(el) {
        const allowed = ['id', 'class', 'href', 'src', 'alt', 'title', 'role', 'name', 'type', 'aria-label', 'aria-labelledby', 'aria-describedby'];
        const out = {};
        allowed.forEach(function (name) {
            if (!el.hasAttribute || !el.hasAttribute(name)) return;
            const value = String(el.getAttribute(name) || '').trim().slice(0, 500);
            if (value) out[name] = value;
        });
        return out;
    }

    function fnv1a(value) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
    }

    function selectionFromElement(el) {
        const snapshot = {
            selector: selectorFor(el),
            tag: el.tagName.toLowerCase(),
            text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
            classes: cleanClasses(el),
            attributes: safeAttributes(el),
            snapshotVersion: 1
        };
        const canonical = JSON.stringify({
            tag: snapshot.tag,
            selector: snapshot.selector,
            text: snapshot.text,
            classes: snapshot.classes,
            attributes: snapshot.attributes
        });
        snapshot.fingerprint = 'fnv1a:' + fnv1a(canonical);
        return snapshot;
    }

    function setHoverTarget(el) {
        if (hoverTarget === el) return;
        if (hoverTarget) hoverTarget.classList.remove('bwm-chat-select-target');
        hoverTarget = el;
        if (hoverTarget) hoverTarget.classList.add('bwm-chat-select-target');
    }

    function stopSelecting() {
        selecting = false;
        document.body.classList.remove('bwm-chat-selecting');
        setHoverTarget(null);
        selectBtn.classList.remove('is-active');
        selectBtn.textContent = 'Select';
    }

    function startSelecting() {
        selecting = true;
        document.body.classList.add('bwm-chat-selecting');
        selectBtn.classList.add('is-active');
        selectBtn.textContent = 'Click an element';
    }

    function showSelection() {
        if (!selectedElement) {
            selectionChip.hidden = true;
            selectionLabel.textContent = '';
            return;
        }
        const label = selectedElement.text || selectedElement.selector || selectedElement.tag;
        // Say "Editing" explicitly: the selection rides along on every message until it is
        // cleared, and a bare element name did not make that obvious.
        selectionLabel.textContent = 'Editing ' + (selectedElement.tag ? '<' + selectedElement.tag + '> ' : '') + label.slice(0, 90);
        selectionChip.hidden = false;
    }

    function clearSelection(announce) {
        if (!selectedElement) return;
        selectedElement = null;
        showSelection();
        if (announce) addMessage('bot', 'Selection cleared. Your next message applies to the whole page.');
    }

    document.addEventListener('mouseover', function (event) {
        if (!selecting) return;
        const target = event.target;
        if (!(target instanceof Element) || widget.contains(target)) return;
        setHoverTarget(target);
    }, true);

    document.addEventListener('click', function (event) {
        if (!selecting) return;
        const target = event.target;
        if (!(target instanceof Element) || widget.contains(target)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        selectedElement = selectionFromElement(target);
        stopSelecting();
        showSelection();
        // No transcript message: selecting again used to append another "Selected ..." line, which
        // read as several live selections when only the newest is ever sent. The chip is the single
        // source of truth for what is selected.
        if (!isOpen) setOpen(true);
        input.focus();
    }, true);

    function setOpen(open) {
        isOpen = open;
        panel.style.display = isOpen ? 'flex' : 'none';
        iconOpen.style.display = isOpen ? 'none' : 'flex';
        iconClose.style.display = isOpen ? 'flex' : 'none';
        if (isOpen) input.focus();
    }

    setOpen(isOpen);
    toggle.addEventListener('click', function () {
        if (selecting) stopSelecting();
        setOpen(!isOpen);
    });
    selectBtn.addEventListener('click', function () {
        if (selecting) stopSelecting(); else startSelecting();
    });
    clearSelectionBtn.addEventListener('click', function () {
        clearSelection(true);
    });

    // Escape is the expected way out of both select mode and an active selection.
    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (selecting) {
            stopSelecting();
            return;
        }
        if (selectedElement) clearSelection(true);
    });

    function addMessage(type, content) {
        const row = document.createElement('div');
        row.className = 'bwm-chat-message bwm-' + type;
        const bubble = document.createElement('div');
        bubble.className = 'bwm-message-content';
        bubble.textContent = String(content || '');
        row.appendChild(bubble);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
        return row;
    }

    function addArtifact(artifact) {
        if (!artifact || typeof artifact !== 'object') return;
        const row = document.createElement('div');
        row.className = 'bwm-chat-artifact';
        const title = document.createElement('strong');
        const detail = document.createElement('span');

        if (artifact.type === 'change_summary') {
            title.textContent = artifact.title || 'Website change';
            detail.textContent = 'Change recorded by Command Center';
        } else if (artifact.type === 'verification_result') {
            title.textContent = artifact.status === 'pass' ? 'Verified' : 'Verification not completed';
            detail.textContent = artifact.status === 'pass'
                ? 'Command Center inspected the rendered page after the change.'
                : 'The change was not visually verified yet.';
        } else if (artifact.type === 'activity_log') {
            const steps = Array.isArray(artifact.steps) ? artifact.steps.slice(0, 20) : [];
            if (!steps.length) {
                title.textContent = 'No site actions';
                detail.textContent = 'The assistant did not read or change anything on this site.';
            } else {
                title.textContent = 'Site actions (' + steps.length + ')';
                detail.textContent = steps
                    .map(function (step) {
                        const name = String((step && step.name) || 'step').slice(0, 60);
                        return (step && step.success ? '✓ ' : '✗ ') + name;
                    })
                    .join('  ');
            }
        } else if (artifact.type === 'warning') {
            title.textContent = 'Needs attention';
            detail.textContent = String(artifact.message || 'Command Center returned a warning.').slice(0, 300);
        } else if (artifact.type === 'approval_request') {
            title.textContent = 'Approval required';
            detail.textContent = String(artifact.summary || artifact.message || 'Review this action before it runs.').slice(0, 300);
        } else if (artifact.type === 'page_reference' && artifact.pageUrl) {
            title.textContent = 'Page';
            const link = document.createElement('a');
            try {
                const url = new URL(String(artifact.pageUrl), window.location.origin);
                if (url.origin !== window.location.origin) return;
                link.href = url.href;
            } catch (_) {
                return;
            }
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'Open page';
            detail.appendChild(link);
        } else {
            return;
        }
        row.appendChild(title);
        row.appendChild(detail);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
    }

    function addTypingIndicator() {
        const row = document.createElement('div');
        row.className = 'bwm-chat-message bwm-bot';
        const bubble = document.createElement('div');
        bubble.className = 'bwm-message-content';
        bubble.innerHTML = '<div class="bwm-typing"><span></span><span></span><span></span></div>';
        row.appendChild(bubble);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
        return row;
    }

    function renderSuggestions(items) {
        if (!Array.isArray(items) || !items.length) return;
        const row = document.createElement('div');
        row.className = 'bwm-chat-suggestions';
        items.slice(0, 4).forEach(function (item) {
            const spec = typeof item === 'string' ? { label: item, prompt: item } : item;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bwm-suggestion';
            button.textContent = String(spec.label || spec.prompt || '').slice(0, 70);
            button.addEventListener('click', function () {
                input.value = String(spec.prompt || spec.label || '');
                input.focus();
            });
            row.appendChild(button);
        });
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
    }

    function contextualSuggestions(data) {
        const artifacts = Array.isArray(data && data.artifacts) ? data.artifacts : [];
        const verified = artifacts.some(function (artifact) {
            return artifact && artifact.type === 'verification_result' && artifact.status === 'pass';
        });
        if (data && data.change_made) {
            return [
                { label: verified ? 'Verify again' : 'Verify this change', prompt: 'Verify this change on desktop and mobile.' },
                { label: 'Undo last change', prompt: '/rollback' },
                { label: 'Adjust mobile', prompt: 'Check this on mobile and fix any spacing or sizing issues.' }
            ];
        }
        if (selectedElement) {
            return [
                { label: 'What controls this?', prompt: 'What controls this selected element?' },
                { label: 'Improve mobile', prompt: 'Improve this selected element on mobile.' },
                { label: 'Rewrite text', prompt: 'Rewrite the text in this selected element to be clearer.' }
            ];
        }
        return [
            { label: 'Inspect this page', prompt: 'Inspect this page and tell me what needs attention.' },
            { label: 'Check mobile', prompt: 'Check this page on mobile for layout issues.' }
        ];
    }

    function classifyRequestRisk(message) {
        const text = String(message || '').toLowerCase();
        const highRisk = [
            /\b(delete|remove)\s+(this\s+|the\s+)?(page|post|product|user|plugin|theme)\b/,
            /\b(uninstall|deactivate)\s+(this\s+|the\s+)?(plugin|theme)\b/,
            /\b(overwrite|replace)\s+(the\s+)?(entire|whole)\b/,
            /\b(replace|rewrite)\s+(this\s+|the\s+)?(entire\s+|whole\s+)?section\b/,
            /\b(drop|truncate)\s+(the\s+)?(table|database)\b/
        ];
        return highRisk.some(function (pattern) { return pattern.test(text); }) ? 'high' : 'low';
    }

    function addRiskConfirmation(message) {
        const row = document.createElement('div');
        row.className = 'bwm-chat-confirmation';
        const copy = document.createElement('div');
        copy.className = 'bwm-confirmation-copy';
        copy.textContent = 'This request could replace or remove a larger piece of the site. Review it before I send it to Command Center.';
        const actions = document.createElement('div');
        actions.className = 'bwm-confirmation-actions';
        const proceed = document.createElement('button');
        proceed.type = 'button';
        proceed.className = 'bwm-confirmation-proceed';
        proceed.textContent = 'Continue';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'bwm-confirmation-cancel';
        cancel.textContent = 'Cancel';
        actions.appendChild(proceed);
        actions.appendChild(cancel);
        row.appendChild(copy);
        row.appendChild(actions);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;

        proceed.addEventListener('click', function () {
            row.remove();
            performSend(message, true);
        });
        cancel.addEventListener('click', function () {
            row.remove();
            addMessage('bot', 'Cancelled. Nothing was sent or changed.');
        });
    }

    function performSend(message, alreadyRendered) {
        if (!message || isLoading) return;
        if (Number(config.usageCount || 0) >= Number(config.dailyLimit || 10)) {
            addMessage('bot', 'You have reached today\'s BWM Chat request limit.');
            return;
        }

        if (!alreadyRendered) addMessage('user', message);
        isLoading = true;
        sendBtn.disabled = true;
        const typing = addTypingIndicator();
        const formData = new FormData();
        formData.append('action', 'bwm_chat_message');
        formData.append('nonce', config.nonce);
        formData.append('session_key', sessionKey);
        formData.append('message', message);
        formData.append('page_url', window.location.href);
        formData.append('post_id', String(config.postId || 0));
        formData.append('post_type', String(config.postType || ''));
        if (selectedElement) formData.append('selection', JSON.stringify(selectedElement));

        fetch(config.ajaxUrl, { method: 'POST', body: formData, credentials: 'same-origin' })
            .then(response => response.json())
            .then(data => {
                typing.remove();
                isLoading = false;
                sendBtn.disabled = false;
                if (!data.success) {
                    addMessage('bot', data.data && data.data.message ? data.data.message : 'Sorry, something went wrong.');
                    return;
                }
                addMessage('bot', data.data.response || 'Request processed.');
                config.usageCount = Number(data.data.usage_count || config.usageCount || 0);
                if (usageCount) usageCount.textContent = String(config.usageCount);
                (Array.isArray(data.data.artifacts) ? data.data.artifacts : []).forEach(addArtifact);
                renderSuggestions(contextualSuggestions(data.data));
            })
            .catch(() => {
                typing.remove();
                isLoading = false;
                sendBtn.disabled = false;
                addMessage('bot', 'Connection error. Please try again.');
            });
    }

    function sendMessage() {
        const message = input.value.trim();
        if (!message || isLoading) return;
        input.value = '';
        if (classifyRequestRisk(message) === 'high') {
            addMessage('user', message);
            addRiskConfirmation(message);
            return;
        }
        performSend(message, false);
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    if (Number(config.usageCount || 0) === 0) {
        renderSuggestions([
            { label: 'Inspect this page', prompt: 'Inspect this page and tell me what needs attention.' },
            { label: 'Select something to edit', prompt: 'I want to select an element and edit it.' },
            { label: 'Check mobile', prompt: 'Check this page on mobile for layout issues.' },
            { label: 'Fix a typo', prompt: 'Help me fix a typo on this page.' }
        ]);
    }
})();
