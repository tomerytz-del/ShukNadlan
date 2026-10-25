import UIKit
import Capacitor
import WebKit
import AuthenticationServices
import AppTrackingTransparency
import CryptoKit
import Security

// כל מחלקות ה-Swift של השלד יושבות בקובץ הזה, כדי לא להוסיף קובץ מקור
// ל-pbxproj. החוזה זהה ל-ShellUrls.java ול-www/native-bridge.js.

enum ShellUrls {
    static let site = "https://shuknadlan.co.il"
    static let siteHost = "shuknadlan.co.il"
    static let offline = "https://localhost/offline.html"
    static let purchaseNote = "https://localhost/purchase-note.html"

    static func rewriteAuthorize(_ raw: String) -> String? {
        guard let parts = URLComponents(string: raw), let host = parts.host?.lowercased() else { return nil }
        let authorize = host.hasSuffix(".supabase.co") && (parts.path).contains("/auth/v1/authorize")
        let google = host == "accounts.google.com"
        if !authorize && !google { return nil }
        if !authorize { return parts.string }
        var next = parts
        var items = next.queryItems ?? []
        items.removeAll { $0.name == "redirect_to" }
        items.append(URLQueryItem(name: "redirect_to", value: "il.co.shuknadlan.app://auth-callback"))
        next.queryItems = items
        return next.string
    }

    static func isExternal(_ raw: String) -> Bool {
        guard let url = URL(string: raw) else { return false }
        let scheme = (url.scheme ?? "").lowercased()
        if ["tel", "mailto", "sms", "geo", "whatsapp", "intent"].contains(scheme) { return true }
        if scheme != "http" && scheme != "https" { return false }
        var host = (url.host ?? "").lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        if ["wa.me", "api.whatsapp.com", "web.whatsapp.com", "chat.whatsapp.com"].contains(host) { return true }
        if host == "waze.com" || host == "ul.waze.com" { return true }
        if host == "maps.apple.com" || host == "maps.google.com" || host == "maps.app.goo.gl" { return true }
        if host == "google.com" && url.path.hasPrefix("/maps") { return true }
        if host == "goo.gl" && url.path.hasPrefix("/maps") { return true }
        return false
    }

    static func isPurchase(_ raw: String) -> Bool {
        guard let url = URL(string: raw) else { return false }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme != "http" && scheme != "https" { return false }
        var host = (url.host ?? "").lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        if isPaymentHost(host) { return true }
        let site = host == siteHost || host.hasSuffix("." + siteHost) || host == "localhost"
        if !site { return false }
        var path = url.path
        if path.hasSuffix(".html") { path = String(path.dropLast(5)) }
        if path.hasSuffix("/") { path = String(path.dropLast()) }
        if path.isEmpty { path = "/" }
        return path == "/pricing" || path == "/checkout"
    }

    private static func isPaymentHost(_ host: String) -> Bool {
        return host == "greeninvoice.co.il" || host.hasSuffix(".greeninvoice.co.il")
            || host == "morning.co" || host.hasSuffix(".morning.co")
            || host == "morning.dev" || host.hasSuffix(".morning.dev")
    }

    static func authReturn(_ callback: String, returnTo: String?) -> String? {
        guard let cb = URLComponents(string: callback) else { return nil }
        if cb.scheme == "https", cb.host == siteHost { return cb.string }
        if cb.scheme != "il.co.shuknadlan.app" { return nil }
        var dest = URLComponents(string: returnTo ?? "") ?? URLComponents(string: site + "/crm")!
        if dest.scheme != "https" || dest.host != siteHost {
            dest = URLComponents(string: site + "/crm")!
        }
        var items = dest.queryItems ?? []
        for item in cb.queryItems ?? [] {
            items.removeAll { $0.name == item.name }
            items.append(item)
        }
        dest.queryItems = items.isEmpty ? nil : items
        if let frag = cb.fragment, !frag.isEmpty { dest.fragment = frag }
        return dest.string
    }
}

// אותו חוזה כמו OauthFlow.java: PKCE, ואז hash שהלקוח ה-implicit באתר קורא.
enum OauthFlow {
    static let cancelled = "ההתחברות עם Google בוטלה. אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה."
    static let failed = "ההתחברות עם Google נכשלה: אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה."
    static let failDetail = "אפשר לנסות שוב, או להיכנס עם אימייל וסיסמה."
    static let tokenURL = "https://obookujgolazrwycsiyn.supabase.co/auth/v1/token?grant_type=pkce"
    static let anon = "sb_publishable_oq0dgmwKy83K7sDO3hoDMA_VpSnR5Fx"
    static let verifierKey = "shuk_oauth_verifier"

    static func hasChallenge(_ raw: String) -> Bool {
        guard let q = raw.firstIndex(of: "?") else { return false }
        let query = raw[raw.index(after: q)...].split(separator: "#", maxSplits: 1).first ?? ""
        return query.split(separator: "&").contains { $0.hasPrefix("code_challenge=") }
    }

    static func verifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            for i in bytes.indices { bytes[i] = UInt8.random(in: 0...255) }
        }
        return base64Url(Data(bytes))
    }

    static func challenge(_ verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return base64Url(Data(digest))
    }

    static func attach(_ raw: String, verifier: String) -> String {
        let extra = "code_challenge=" + challenge(verifier) + "&code_challenge_method=s256"
        guard let hash = raw.firstIndex(of: "#") else {
            return raw + (raw.contains("?") ? "&" : "?") + extra
        }
        let base = String(raw[..<hash])
        return base + (base.contains("?") ? "&" : "?") + extra + String(raw[hash...])
    }

    static func safeReturn(_ returnTo: String?) -> String {
        var base = returnTo ?? ""
        if let hash = base.firstIndex(of: "#") { base = String(base[..<hash]) }
        if base.hasPrefix(ShellUrls.site + "/") || base == ShellUrls.site { return base }
        return ShellUrls.site + "/crm"
    }

    static func implicitReturn(returnTo: String?, access: String, refresh: String, expires: String, type: String) -> String {
        let frag = "access_token=" + urlEncode(access)
            + "&refresh_token=" + urlEncode(refresh)
            + "&expires_in=" + urlEncode(expires.isEmpty ? "3600" : expires)
            + "&token_type=" + urlEncode(type.isEmpty ? "bearer" : type)
        let base = safeReturn(returnTo)
        let sep = base.contains("?") ? "&" : "?"
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000))
        return base + sep + "shuk_oauth=" + stamp + "#" + frag
    }

    static func errorReturn(returnTo: String?, cancel: Bool) -> String {
        let base = safeReturn(returnTo)
        let sep = base.contains("?") ? "&" : "?"
        if cancel { return base + sep + "error=access_denied" }
        return base + sep + "error=server_error&error_description=" + urlEncode(failDetail)
    }

    static func exchange(code: String, verifier: String, done: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let url = URL(string: tokenURL) else {
            done(.failure(NSError(domain: "ShukAuth", code: 0)))
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.setValue("Bearer " + anon, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "auth_code": code,
            "code_verifier": verifier,
        ])
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error = error {
                done(.failure(error))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status),
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let access = json["access_token"] as? String, !access.isEmpty,
                  let refresh = json["refresh_token"] as? String, !refresh.isEmpty else {
                done(.failure(NSError(domain: "ShukAuth", code: status)))
                return
            }
            done(.success(json))
        }.resume()
    }

    static func stringValue(_ value: Any?) -> String {
        if let number = value as? NSNumber { return number.stringValue }
        if let text = value as? String, !text.isEmpty { return text }
        return "3600"
    }

    private static func base64Url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func urlEncode(_ raw: String) -> String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?")
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }
}

// אותו סדר כמו WhatsappLinks.java: וואטסאפ, אחר כך הדפדפן, ואז החנות.
enum ExternalLinks {
    static func open(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("intent:") {
            if let fallback = intentFallback(trimmed), !fallback.isEmpty, fallback != trimmed {
                open(fallback)
                return
            }
        }
        if let send = whatsappSend(trimmed),
           let sendURL = URL(string: send),
           let probe = URL(string: "whatsapp://send"),
           UIApplication.shared.canOpenURL(probe) {
            UIApplication.shared.open(sendURL, options: [:], completionHandler: nil)
            return
        }
        guard let url = URL(string: trimmed) else { return }
        UIApplication.shared.open(url, options: [:]) { ok in
            if ok || !isWhatsappWeb(url) { return }
            if let store = URL(string: "https://apps.apple.com/app/whatsapp-messenger/id310633997") {
                UIApplication.shared.open(store, options: [:], completionHandler: nil)
            }
        }
    }

    private static func isWhatsappWeb(_ url: URL) -> Bool {
        if (url.scheme ?? "").lowercased() == "whatsapp" { return true }
        var host = (url.host ?? "").lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        return ["wa.me", "api.whatsapp.com", "web.whatsapp.com", "chat.whatsapp.com"].contains(host)
    }

    private static func whatsappSend(_ raw: String) -> String? {
        guard let parts = URLComponents(string: raw) else { return nil }
        let scheme = (parts.scheme ?? "").lowercased()
        if scheme == "whatsapp" { return raw }
        if scheme != "https" && scheme != "http" { return nil }
        var host = (parts.host ?? "").lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        let query = parts.queryItems ?? []
        func value(_ name: String) -> String? {
            query.first { $0.name == name }?.value
        }
        if host == "wa.me" {
            var seg = parts.path
            if seg.hasPrefix("/") { seg.removeFirst() }
            if seg.hasSuffix("/") { seg.removeLast() }
            if seg.contains("/") { return nil }
            let phone = seg == "send" ? digits(value("phone")) : (digits(seg).isEmpty ? digits(value("phone")) : digits(seg))
            return buildSend(phone: phone, text: value("text"))
        }
        if host == "api.whatsapp.com" || host == "web.whatsapp.com" {
            if parts.path != "/send" && !parts.path.hasPrefix("/send/") { return nil }
            return buildSend(phone: digits(value("phone")), text: value("text"))
        }
        return nil
    }

    private static func intentFallback(_ raw: String) -> String? {
        guard let marker = raw.range(of: "#Intent;") else { return nil }
        var tail = String(raw[marker.upperBound...])
        if tail.hasSuffix(";end") { tail.removeLast(4) }
        else if tail.hasSuffix("end") { tail.removeLast(3) }
        for part in tail.split(separator: ";") {
            let row = String(part)
            let prefix = "S.browser_fallback_url="
            if row.hasPrefix(prefix) {
                return row.dropFirst(prefix.count).removingPercentEncoding
            }
        }
        return nil
    }

    private static func buildSend(phone: String, text: String?) -> String {
        var url = "whatsapp://send"
        var parts: [String] = []
        if !phone.isEmpty, let encoded = phone.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            parts.append("phone=" + encoded)
        }
        if let text = text, let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            parts.append("text=" + encoded)
        }
        if !parts.isEmpty { url += "?" + parts.joined(separator: "&") }
        return url
    }

    private static func digits(_ raw: String?) -> String {
        raw?.filter { $0.isNumber } ?? ""
    }
}

@objc(ShukShellPlugin)
public class ShukShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShukShellPlugin"
    public let jsName = "ShukShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeOAuthReturn", returnType: CAPPluginReturnPromise)
    ]

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), !raw.isEmpty else {
            call.reject("bad_url")
            return
        }
        DispatchQueue.main.async {
            ExternalLinks.open(raw)
            call.resolve()
        }
    }

    @objc func consumeOAuthReturn(_ call: CAPPluginCall) {
        let url = UserDefaults.standard.string(forKey: "shuk_oauth_return") ?? ""
        UserDefaults.standard.removeObject(forKey: "shuk_oauth_return")
        call.resolve(["url": url])
    }
}

class ShukNavigationProxy: NSObject, WKNavigationDelegate {
    weak var forward: WKNavigationDelegate?
    weak var owner: ShukBridgeViewController?

    init(forward: WKNavigationDelegate, owner: ShukBridgeViewController) {
        self.forward = forward
        self.owner = owner
    }

    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return forward?.responds(to: aSelector) ?? false
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        return forward
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let main = navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true
        if main, let url = navigationAction.request.url, owner?.consumeNavigation(url, webView: webView) == true {
            decisionHandler(.cancel)
            return
        }
        if let forward = forward {
            forward.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        owner?.pushTracking(webView)
        forward?.webView?(webView, didFinish: navigation)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        owner?.showOfflineIfNeeded(webView, error: error)
        forward?.webView?(webView, didFail: navigation, withError: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        owner?.showOfflineIfNeeded(webView, error: error)
        forward?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }
}

class ShukBridgeViewController: CAPBridgeViewController, ASWebAuthenticationPresentationContextProviding {
    private var navProxy: ShukNavigationProxy?
    private var authSession: ASWebAuthenticationSession?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ShukShellPlugin())
        injectBridge()
        webView?.allowsBackForwardNavigationGestures = true
        if let webView = webView, let existing = webView.navigationDelegate {
            let proxy = ShukNavigationProxy(forward: existing, owner: self)
            navProxy = proxy
            webView.navigationDelegate = proxy
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return view.window ?? ASPresentationAnchor()
    }

    func consumeNavigation(_ url: URL, webView: WKWebView) -> Bool {
        let raw = url.absoluteString
        if let rewritten = ShellUrls.rewriteAuthorize(raw), let next = URL(string: rewritten) {
            beginOAuth(next, webView: webView)
            return true
        }
        if ShellUrls.isPurchase(raw) {
            showPurchaseNote(webView)
            return true
        }
        if ShellUrls.isExternal(raw) {
            ExternalLinks.open(raw)
            return true
        }
        return false
    }

    func showPurchaseNote(_ webView: WKWebView) {
        let current = webView.url?.absoluteString ?? ""
        if current.hasPrefix(ShellUrls.purchaseNote) { return }
        if let note = URL(string: ShellUrls.purchaseNote) {
            webView.load(URLRequest(url: note))
        }
    }

    func pushTracking(_ webView: WKWebView) {
        guard let allowed = TrackingStatus.latest else { return }
        let js = "try{if(window.ShukNadlanApp&&window.ShukNadlanApp.setTrackingAllowed)window.ShukNadlanApp.setTrackingAllowed(\(allowed));}catch(e){}"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        TrackingStatus.ask { [weak self] in
            guard let self = self, let webView = self.webView else { return }
            self.pushTracking(webView)
        }
    }

    func showOfflineIfNeeded(_ webView: WKWebView, error: Error) {
        let code = (error as NSError).code
        if ![-1009, -1001, -1003, -1005, -1004].contains(code) { return }
        let current = webView.url?.absoluteString ?? ""
        if current.contains("offline.html") { return }
        if let offline = URL(string: ShellUrls.offline) {
            webView.load(URLRequest(url: offline))
        }
    }

    private func beginOAuth(_ url: URL, webView: WKWebView) {
        if let current = webView.url?.absoluteString, current.hasPrefix(ShellUrls.site) {
            let trimmed = current.split(separator: "#", maxSplits: 1).first.map(String.init) ?? current
            UserDefaults.standard.set(trimmed, forKey: "shuk_oauth_return")
        }
        var launch = url
        if url.absoluteString.contains("/auth/v1/authorize") && !OauthFlow.hasChallenge(url.absoluteString) {
            let verifier = OauthFlow.verifier()
            if let next = URL(string: OauthFlow.attach(url.absoluteString, verifier: verifier)) {
                UserDefaults.standard.set(verifier, forKey: OauthFlow.verifierKey)
                launch = next
            }
        }
        let session = ASWebAuthenticationSession(url: launch, callbackURLScheme: "il.co.shuknadlan.app") { [weak self, weak webView] callback, error in
            DispatchQueue.main.async {
                self?.finishOAuth(callback: callback, error: error, webView: webView)
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        if !session.start() {
            deliverOauthError(cancel: false, webView: webView, clearVerifier: true)
        }
    }

    private func finishOAuth(callback: URL?, error: Error?, webView: WKWebView?) {
        guard let webView = webView else { return }
        let back = UserDefaults.standard.string(forKey: "shuk_oauth_return")
        guard let callback = callback else {
            let ns = error as NSError?
            let cancelled = ns == nil
                || (ns?.domain == ASWebAuthenticationSessionError.errorDomain
                    && ns?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue)
            NSLog("ShukAuth oauth closed without a callback cancel=%d", cancelled ? 1 : 0)
            deliverOauthError(cancel: cancelled, webView: webView, clearVerifier: false)
            return
        }
        let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false)
        let errorCode = parts?.queryItems?.first { $0.name == "error" }?.value ?? ""
        let code = parts?.queryItems?.first { $0.name == "code" }?.value ?? ""
        NSLog("ShukAuth oauth callback hasCode=%d hasError=%d", code.isEmpty ? 0 : 1, errorCode.isEmpty ? 0 : 1)
        if !errorCode.isEmpty {
            let cancel = errorCode.range(of: "access_denied", options: .caseInsensitive) != nil
                || errorCode.range(of: "cancel", options: .caseInsensitive) != nil
            deliverOauthError(cancel: cancel, webView: webView, clearVerifier: true)
            return
        }
        if code.isEmpty {
            deliverOauthError(cancel: false, webView: webView, clearVerifier: true)
            return
        }
        let verifier = UserDefaults.standard.string(forKey: OauthFlow.verifierKey) ?? ""
        UserDefaults.standard.removeObject(forKey: OauthFlow.verifierKey)
        if verifier.isEmpty {
            NSLog("ShukAuth oauth callback without a stored verifier")
            deliverOauthError(cancel: false, webView: webView, clearVerifier: false)
            return
        }
        OauthFlow.exchange(code: code, verifier: verifier) { [weak webView] result in
            DispatchQueue.main.async {
                guard let webView = webView else { return }
                switch result {
                case .success(let json):
                    let access = json["access_token"] as? String ?? ""
                    let refresh = json["refresh_token"] as? String ?? ""
                    let expires = OauthFlow.stringValue(json["expires_in"])
                    let type = json["token_type"] as? String ?? "bearer"
                    let dest = OauthFlow.implicitReturn(returnTo: back, access: access, refresh: refresh, expires: expires, type: type)
                    if let destURL = URL(string: dest) {
                        webView.load(URLRequest(url: destURL))
                    }
                case .failure:
                    NSLog("ShukAuth oauth token exchange failed")
                    self.deliverOauthError(cancel: false, webView: webView, clearVerifier: false)
                }
            }
        }
    }

    private func deliverOauthError(cancel: Bool, webView: WKWebView, clearVerifier: Bool) {
        if clearVerifier { UserDefaults.standard.removeObject(forKey: OauthFlow.verifierKey) }
        let message = cancel ? OauthFlow.cancelled : OauthFlow.failed
        let quoted = message
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        webView.evaluateJavaScript(
            "try{if(window.ShukNative&&window.ShukNative.failOAuth)window.ShukNative.failOAuth('\(quoted)');}catch(e){}",
            completionHandler: nil)
        let back = UserDefaults.standard.string(forKey: "shuk_oauth_return")
        if let destURL = URL(string: OauthFlow.errorReturn(returnTo: back, cancel: cancel)) {
            webView.load(URLRequest(url: destURL))
        }
    }

    private func injectBridge() {
        guard let webView = webView else { return }
        let bundled = Bundle.main.url(forResource: "native-bridge", withExtension: "js", subdirectory: "public")
            ?? Bundle.main.url(forResource: "native-bridge", withExtension: "js")
        guard let bundled = bundled, let source = try? String(contentsOf: bundled, encoding: .utf8) else { return }
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(script)
    }
}

enum TrackingStatus {
    static var latest: Bool?
    private static var asked = false

    static func ask(_ done: @escaping () -> Void) {
        if asked {
            done()
            return
        }
        asked = true
        if #available(iOS 14, *) {
            ATTrackingManager.requestTrackingAuthorization { status in
                let allowed: Bool?
                switch status {
                case .authorized:
                    allowed = true
                case .denied, .restricted:
                    allowed = false
                case .notDetermined:
                    asked = false
                    allowed = nil
                @unknown default:
                    allowed = false
                }
                DispatchQueue.main.async {
                    if let allowed = allowed { latest = allowed }
                    done()
                }
            }
        } else {
            latest = true
            done()
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
