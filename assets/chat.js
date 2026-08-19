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

    function selectionFromElement(el) {
        return {
            selector: selectorFor(el),
            tag: el.tagName.toLowerCase(),
            text: String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
            classes: cleanClasses(el)
        };
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
        selectionLabel.textContent = (selectedElement.tag ? '<' + selectedElement.tag + '> ' : '') + label.slice(0, 90);
        selectionChip.hidden = false;
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
        addMessage('bot', 'Selected ' + (selectedElement.selector || selectedElement.tag) + '. Tell me what you want changed.');
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
        selectedElement = null;
        showSelection();
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

    function sendMessage() {
        const message = input.value.trim();
        if (!message || isLoading) return;
        if (Number(config.usageCount || 0) >= Number(config.dailyLimit || 10)) {
            addMessage('bot', 'You have reached today\'s BWM Chat request limit.');
            return;
        }

        addMessage('user', message);
        input.value = '';
        isLoading = true;
        sendBtn.disabled = true;
        const typing = addTypingIndicator();
        const formData = new FormData();
        formData.append('action', 'bwm_chat_message');
        formData.append('nonce', config.nonce);
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
                usageCount.textContent = String(config.usageCount);
                (Array.isArray(data.data.artifacts) ? data.data.artifacts : []).forEach(addArtifact);
            })
            .catch(() => {
                typing.remove();
                isLoading = false;
                sendBtn.disabled = false;
                addMessage('bot', 'Connection error. Please try again.');
            });
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    if (Number(config.usageCount || 0) === 0) {
        const suggestions = ['What controls this section?', 'Make this heading smaller on mobile', 'Fix a typo', 'Update this page content'];
        const row = document.createElement('div');
        row.className = 'bwm-chat-suggestions';
        suggestions.forEach(text => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bwm-suggestion';
            button.textContent = text;
            button.addEventListener('click', function () {
                input.value = text;
                input.focus();
            });
            row.appendChild(button);
        });
        messages.appendChild(row);
    }
})();
