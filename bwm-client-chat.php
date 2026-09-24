<?php
/**
 * Plugin Name: BWM Client Chat
 * Plugin URI: https://www.betterwebmanagement.com
 * Description: Client-facing website assistant powered by Better Web Management Command Center.
 * Version: 2.1.2
 * Author: Better Web Management
 * Author URI: https://www.betterwebmanagement.com
 * License: GPL v2 or later
 * Text Domain: bwm-client-chat
 */

if (!defined('ABSPATH')) exit;

final class BWM_Client_Chat {
    private static $instance = null;
    private $option_name = 'bwm_client_chat_settings';
    private $version = '2.1.2';

    public static function get_instance() {
        if (self::$instance === null) self::$instance = new self();
        return self::$instance;
    }

    private function __construct() {
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_frontend_assets']);
        add_action('wp_footer', [$this, 'render_chat_widget']);
        add_action('wp_ajax_bwm_chat_message', [$this, 'ajax_handle_message']);
        add_filter('plugin_action_links_' . plugin_basename(__FILE__), [$this, 'add_settings_link']);
    }

    private function api_endpoint() {
        $endpoint = defined('BWM_CLIENT_CHAT_API_ENDPOINT')
            ? BWM_CLIENT_CHAT_API_ENDPOINT
            : 'https://bwmxdev.com/api/client-chat';
        return untrailingslashit((string) apply_filters('bwm_client_chat_api_endpoint', $endpoint));
    }

    public function add_admin_menu() {
        add_menu_page('BWM Chat Assistant', 'BWM Chat', 'manage_options', 'bwm-client-chat', [$this, 'render_settings_page'], 'dashicons-format-chat', 30);
    }

    public function register_settings() {
        register_setting($this->option_name, $this->option_name, ['sanitize_callback' => [$this, 'sanitize_settings']]);
    }

    public function sanitize_settings($input) {
        if (!current_user_can('manage_options')) return $this->get_settings();
        $existing = get_option($this->option_name, []);
        $color = sanitize_hex_color($input['primary_color'] ?? '#2563eb');
        return [
            'client_api_key' => $existing['client_api_key'] ?? '',
            'credential_id' => $existing['credential_id'] ?? '',
            'credential_fingerprint' => $existing['credential_fingerprint'] ?? '',
            'enabled' => isset($input['enabled']) && $input['enabled'] === '1',
            'open_by_default' => isset($input['open_by_default']) && $input['open_by_default'] === '1',
            'allowed_roles' => isset($input['allowed_roles']) ? array_values(array_filter(array_map('sanitize_key', (array) $input['allowed_roles']))) : ['administrator', 'editor'],
            'daily_limit' => max(1, min(100, intval($input['daily_limit'] ?? 10))),
            'position' => in_array(($input['position'] ?? ''), ['bottom-center', 'bottom-right', 'bottom-left'], true) ? $input['position'] : 'bottom-center',
            'primary_color' => $color ?: '#2563eb',
            'welcome_message' => sanitize_textarea_field($input['welcome_message'] ?? 'Hi! I can help you inspect and update your website. What would you like to change?'),
        ];
    }

    private function get_settings() {
        return wp_parse_args(get_option($this->option_name, []), [
            'client_api_key' => '',
            'credential_id' => '',
            'credential_fingerprint' => '',
            'enabled' => false,
            'open_by_default' => false,
            'allowed_roles' => ['administrator', 'editor'],
            'daily_limit' => 10,
            'position' => 'bottom-center',
            'primary_color' => '#2563eb',
            'welcome_message' => 'Hi! I can help you inspect and update your website. What would you like to change?',
        ]);
    }

    private function store_registration(array $registration) {
        $token = sanitize_text_field($registration['api_key'] ?? '');
        if ($token === '') return false;
        $settings = $this->get_settings();
        $settings['client_api_key'] = $token;
        $settings['credential_id'] = sanitize_text_field($registration['credential_id'] ?? '');
        $settings['credential_fingerprint'] = sanitize_text_field($registration['fingerprint'] ?? '');
        update_option($this->option_name, $settings, false);
        return $settings;
    }

    private function masked_client_key($key) {
        $key = (string) $key;
        if ($key === '') return 'not connected';
        if (strlen($key) <= 12) return 'configured';
        return substr($key, 0, 8) . '…' . substr($key, -4);
    }

    private function get_usage() {
        $today = current_time('Y-m-d');
        $usage = get_option('bwm_client_chat_usage', ['count' => 0, 'date' => $today, 'messages' => []]);
        if (($usage['date'] ?? '') !== $today) {
            $usage = ['count' => 0, 'date' => $today, 'messages' => []];
            update_option('bwm_client_chat_usage', $usage, false);
        }
        return $usage;
    }

    public function add_settings_link($links) {
        if (current_user_can('manage_options')) $links[] = '<a href="' . esc_url(admin_url('admin.php?page=bwm-client-chat')) . '">Settings</a>';
        return $links;
    }

    private function api_post($path, array $payload, $timeout = 90) {
        $response = wp_remote_post($this->api_endpoint() . $path, [
            'timeout' => $timeout,
            'redirection' => 0,
            'headers' => ['Content-Type' => 'application/json', 'Accept' => 'application/json'],
            'body' => wp_json_encode($payload),
        ]);
        if (is_wp_error($response)) return ['ok' => false, 'status' => 0, 'body' => [], 'error' => 'Command Center connection failed'];
        $status = wp_remote_retrieve_response_code($response);
        $decoded = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($decoded)) $decoded = [];
        return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'body' => $decoded, 'error' => ''];
    }

    /** Command Center issues the scoped site credential after one-time BWM Remote ownership proof. */
    private function auto_register() {
        $remote_settings = get_option('bwm_remote_settings', []);
        $site_token = is_array($remote_settings) ? sanitize_text_field($remote_settings['token'] ?? '') : '';
        if ($site_token === '') return false;
        $result = $this->api_post('/register', ['site_url' => get_site_url(), 'site_token' => $site_token], 20);
        if (!$result['ok'] || empty($result['body']['success']) || empty($result['body']['api_key'])) return false;
        return $this->store_registration($result['body']);
    }

    private function ensure_registration() {
        $settings = $this->get_settings();
        if (empty($settings['client_api_key'])) return $this->auto_register() ?: $settings;
        $verified = $this->api_post('/verify', ['api_key' => $settings['client_api_key'], 'site_url' => get_site_url()], 12);
        if ($verified['ok'] && !empty($verified['body']['active'])) return $settings;
        if ($verified['ok'] && !empty($verified['body']['registration_needed'])) return $this->auto_register() ?: $settings;
        return $settings;
    }

    private function verify_subscription($client_api_key) {
        if (!$client_api_key) return ['active' => false, 'registration_needed' => true];
        $result = $this->api_post('/verify', ['api_key' => $client_api_key, 'site_url' => get_site_url()], 12);
        if (!$result['ok']) return ['active' => false, 'reason' => 'Command Center connection unavailable'];
        return $result['body'];
    }

    public function render_settings_page() {
        if (!current_user_can('manage_options')) return;
        $settings = $this->ensure_registration();
        $usage = $this->get_usage();
        $subscription = $this->verify_subscription($settings['client_api_key']);
        ?>
        <div class="wrap">
            <h1>BWM Chat Assistant</h1>
            <p>The chat widget is a secure interface to Better Web Management Command Center. The AI runtime and privileged site tools do not run inside WordPress.</p>
            <?php if (empty($subscription['active'])): ?>
                <div class="notice notice-warning"><p><strong>Connection required:</strong> Command Center could not verify this site. Make sure BWM Remote Management is connected, then reload this page.</p></div>
            <?php else: ?>
                <div class="notice notice-success"><p><strong>Connected:</strong> <?php echo esc_html($subscription['site_name'] ?? 'This site'); ?> is linked to Command Center.</p></div>
            <?php endif; ?>
            <div class="card" style="max-width:800px;margin-top:20px;">
                <h2>Site Credential</h2>
                <p>Command Center issues and manages this scoped credential. It stays server-side and can be revoked from Command Center Security.</p>
                <code style="display:block;padding:12px;overflow-wrap:anywhere;"><?php echo esc_html($this->masked_client_key($settings['client_api_key'])); ?></code>
                <?php if (!empty($settings['credential_fingerprint'])): ?><p class="description">Fingerprint: <?php echo esc_html($settings['credential_fingerprint']); ?></p><?php endif; ?>
                <p class="description">Command Center endpoint: <?php echo esc_html($this->api_endpoint()); ?></p>
            </div>
            <div class="card" style="max-width:800px;margin-top:20px;">
                <h2>Today's Usage</h2>
                <p><strong><?php echo esc_html($usage['count']); ?></strong> of <strong><?php echo esc_html($settings['daily_limit']); ?></strong> requests used today.</p>
            </div>
            <form method="post" action="options.php">
                <?php settings_fields($this->option_name); ?>
                <div class="card" style="max-width:800px;margin-top:20px;">
                    <h2>Settings</h2>
                    <table class="form-table">
                        <tr><th scope="row">Enable Chat Widget</th><td><label><input type="checkbox" name="<?php echo esc_attr($this->option_name); ?>[enabled]" value="1" <?php checked($settings['enabled']); ?>> Show chat widget for eligible users</label></td></tr>
                        <tr><th scope="row">Open by Default</th><td><label><input type="checkbox" name="<?php echo esc_attr($this->option_name); ?>[open_by_default]" value="1" <?php checked($settings['open_by_default']); ?>> Open chat when the page loads</label></td></tr>
                        <tr><th scope="row">Allowed Roles</th><td>
                            <?php foreach (['administrator' => 'Administrators', 'editor' => 'Editors', 'author' => 'Authors', 'contributor' => 'Contributors'] as $role => $label): ?>
                                <label style="display:block;margin-bottom:8px;"><input type="checkbox" name="<?php echo esc_attr($this->option_name); ?>[allowed_roles][]" value="<?php echo esc_attr($role); ?>" <?php checked(in_array($role, $settings['allowed_roles'], true)); ?>> <?php echo esc_html($label); ?></label>
                            <?php endforeach; ?>
                        </td></tr>
                        <tr><th scope="row">Daily Request Limit</th><td><input type="number" name="<?php echo esc_attr($this->option_name); ?>[daily_limit]" value="<?php echo esc_attr($settings['daily_limit']); ?>" min="1" max="100"></td></tr>
                        <tr><th scope="row">Widget Position</th><td><select name="<?php echo esc_attr($this->option_name); ?>[position]">
                            <option value="bottom-center" <?php selected($settings['position'], 'bottom-center'); ?>>Bottom Center</option>
                            <option value="bottom-right" <?php selected($settings['position'], 'bottom-right'); ?>>Bottom Right</option>
                            <option value="bottom-left" <?php selected($settings['position'], 'bottom-left'); ?>>Bottom Left</option>
                        </select></td></tr>
                        <tr><th scope="row">Brand Color</th><td><input type="color" name="<?php echo esc_attr($this->option_name); ?>[primary_color]" value="<?php echo esc_attr($settings['primary_color']); ?>"></td></tr>
                        <tr><th scope="row">Welcome Message</th><td><textarea name="<?php echo esc_attr($this->option_name); ?>[welcome_message]" rows="2" cols="50" class="large-text"><?php echo esc_textarea($settings['welcome_message']); ?></textarea></td></tr>
                    </table>
                    <?php submit_button('Save Settings'); ?>
                </div>
            </form>
        </div>
        <?php
    }

    public function enqueue_frontend_assets() {
        if (!$this->can_user_access()) return;
        $settings = $this->get_settings();
        if (empty($settings['enabled']) || empty($settings['client_api_key'])) return;
        wp_enqueue_style('bwm-chat-css', plugin_dir_url(__FILE__) . 'assets/chat.css', [], $this->version);
        wp_enqueue_script('bwm-chat-js', plugin_dir_url(__FILE__) . 'assets/chat.js', [], $this->version, true);
        $post_id = get_queried_object_id();
        wp_localize_script('bwm-chat-js', 'bwmChat', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('bwm_chat_nonce'),
            'position' => $settings['position'],
            'primaryColor' => $settings['primary_color'],
            'welcomeMessage' => $settings['welcome_message'],
            'dailyLimit' => $settings['daily_limit'],
            'usageCount' => $this->get_usage()['count'],
            'isLoggedIn' => is_user_logged_in(),
            'userName' => wp_get_current_user()->display_name,
            'openByDefault' => $settings['open_by_default'],
            'postId' => $post_id ? intval($post_id) : 0,
            'postType' => $post_id ? (string) get_post_type($post_id) : '',
        ]);
    }

    private function can_user_access() {
        if (!is_user_logged_in()) return false;
        $settings = $this->get_settings();
        $user = wp_get_current_user();
        return !empty(array_intersect((array) $settings['allowed_roles'], (array) $user->roles));
    }

    private function sanitize_selection($raw) {
        if (!$raw) return null;
        $decoded = json_decode(wp_unslash($raw), true);
        if (!is_array($decoded)) return null;
        $classes = [];
        foreach (array_slice((array) ($decoded['classes'] ?? []), 0, 20) as $class) {
            $clean = sanitize_html_class($class);
            if ($clean !== '') $classes[] = substr($clean, 0, 80);
        }
        return array_filter([
            'selector' => substr(sanitize_text_field($decoded['selector'] ?? ''), 0, 500),
            'tag' => substr(sanitize_key($decoded['tag'] ?? ''), 0, 80),
            'text' => substr(sanitize_text_field($decoded['text'] ?? ''), 0, 1000),
            'classes' => $classes,
        ], function($value) { return $value !== '' && $value !== []; });
    }

    private function sanitize_page_context() {
        $page_url = esc_url_raw(wp_unslash($_POST['page_url'] ?? ''));
        $site = wp_parse_url(get_site_url());
        $page = wp_parse_url($page_url);
        $site_origin = strtolower(($site['scheme'] ?? 'https') . '://' . ($site['host'] ?? '') . (isset($site['port']) ? ':' . $site['port'] : ''));
        $page_origin = strtolower(($page['scheme'] ?? '') . '://' . ($page['host'] ?? '') . (isset($page['port']) ? ':' . $page['port'] : ''));
        if (!$page_url || $page_origin !== $site_origin) $page_url = get_site_url();
        $post_id = absint($_POST['post_id'] ?? 0);
        $post_type = sanitize_key($_POST['post_type'] ?? '');
        return array_filter(['url' => $page_url, 'postId' => $post_id ?: null, 'postType' => $post_type ?: null], function($value) { return $value !== null && $value !== ''; });
    }

    public function ajax_handle_message() {
        if (!wp_verify_nonce($_POST['nonce'] ?? '', 'bwm_chat_nonce')) wp_send_json_error(['message' => 'Security check failed. Please refresh the page.'], 403);
        if (!$this->can_user_access()) wp_send_json_error(['message' => 'You do not have permission to use this feature.'], 403);
        $settings = $this->get_settings();
        $usage = $this->get_usage();
        if ($usage['count'] >= $settings['daily_limit']) wp_send_json_error(['message' => 'Daily BWM Chat request limit reached. Please try again tomorrow.'], 429);
        $message = substr(sanitize_textarea_field(wp_unslash($_POST['message'] ?? '')), 0, 6000);
        if ($message === '') wp_send_json_error(['message' => 'Please enter a message.'], 400);
        if (empty($settings['client_api_key'])) wp_send_json_error(['message' => 'BWM Chat is not connected.'], 503);

        $user = wp_get_current_user();
        $result = $this->api_post('/message', [
            'api_key' => $settings['client_api_key'],
            'site_url' => get_site_url(),
            'message' => $message,
            'page' => $this->sanitize_page_context(),
            'selection' => $this->sanitize_selection($_POST['selection'] ?? ''),
            'user' => ['wpUserId' => intval($user->ID), 'name' => $user->display_name, 'roles' => array_values((array) $user->roles)],
        ], 120);

        $body = $result['body'];
        if (!$result['ok'] || empty($body['success'])) {
            $message_out = $body['response'] ?? $body['error'] ?? $result['error'] ?? 'Unable to connect to BWM Chat service.';
            wp_send_json_error(['message' => sanitize_text_field($message_out)], $result['status'] ?: 500);
        }
        $usage['count']++;
        $usage['messages'][] = ['time' => current_time('mysql'), 'message' => substr($message, 0, 100)];
        $usage['messages'] = array_slice($usage['messages'], -100);
        update_option('bwm_client_chat_usage', $usage, false);
        wp_send_json_success([
            'response' => sanitize_textarea_field($body['response'] ?? 'Request processed.'),
            'change_made' => !empty($body['change_made']),
            'artifacts' => is_array($body['artifacts'] ?? null) ? $body['artifacts'] : [],
            'usage_count' => $usage['count'],
            'daily_limit' => $settings['daily_limit'],
            'remaining' => isset($body['remaining']) ? intval($body['remaining']) : max(0, $settings['daily_limit'] - $usage['count']),
        ]);
    }

    public function render_chat_widget() {
        if (!$this->can_user_access()) return;
        $settings = $this->get_settings();
        if (empty($settings['enabled']) || empty($settings['client_api_key'])) return;
        $position = $settings['position'];
        $position_style = 'bottom:24px;';
        $panel_style = '';
        if ($position === 'bottom-left') { $position_style .= 'left:24px;'; $panel_style = 'left:0;'; }
        elseif ($position === 'bottom-right') { $position_style .= 'right:24px;'; $panel_style = 'right:0;'; }
        else { $position_style .= 'left:50%;transform:translateX(-50%);'; $panel_style = 'left:50%;transform:translateX(-50%);'; }
        $open = !empty($settings['open_by_default']);
        ?>
        <div id="bwm-chat-widget" class="bwm-position-<?php echo esc_attr($position); ?>" style="<?php echo esc_attr($position_style); ?>" data-color="<?php echo esc_attr($settings['primary_color']); ?>">
            <button id="bwm-chat-toggle" class="bwm-chat-btn" type="button" aria-label="Open BWM Chat"><span class="bwm-chat-icon" style="display:<?php echo $open ? 'none' : 'flex'; ?>;">💬</span><span class="bwm-chat-close" style="display:<?php echo $open ? 'flex' : 'none'; ?>;">×</span></button>
            <div id="bwm-chat-panel" style="display:<?php echo $open ? 'flex' : 'none'; ?>;<?php echo esc_attr($panel_style); ?>">
                <div class="bwm-chat-header"><div class="bwm-chat-title"><strong>BWM Assistant</strong><small>Powered by Command Center</small></div><div class="bwm-chat-header-actions"><button id="bwm-chat-select-element" type="button" class="bwm-select-btn" title="Select an element on this page">Select</button></div></div>
                <div id="bwm-chat-selection" class="bwm-selection-chip" hidden><span id="bwm-chat-selection-label"></span><button id="bwm-chat-clear-selection" type="button" aria-label="Clear selected element" title="Clear selected element (Esc)">× Deselect</button></div>
                <div id="bwm-chat-messages" aria-live="polite"><div class="bwm-chat-message bwm-bot"><div class="bwm-message-content"><?php echo esc_html($settings['welcome_message']); ?></div></div></div>
                <div class="bwm-chat-input-area"><textarea id="bwm-chat-input" placeholder="Ask about this page or describe a change..." rows="2"></textarea><button id="bwm-chat-send" class="bwm-send-btn" type="button" aria-label="Send message">➤</button></div>
                <div class="bwm-chat-footer"><a href="https://www.betterwebmanagement.com" target="_blank" rel="noopener">betterwebmanagement.com</a></div>
            </div>
        </div>
        <?php
    }
}

BWM_Client_Chat::get_instance();