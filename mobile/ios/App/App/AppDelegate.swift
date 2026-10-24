import UIKit
import Capacitor
import WebKit
import AuthenticationServices

// כל מחלקות ה-Swift של השלד יושבות בקובץ הזה, כדי לא להוסיף קובץ מקור
// ל-pbxproj. החוזה זהה ל-ShellUrls.java ול-www/native-bridge.js.

enum ShellUrls {
    static let site = "https://shuknadlan.co.il"
    static let siteHost = "shuknadlan.co.il"
    static let offline = "https://localhost/offline.html"

    static func rewriteAuthorize(_ raw: String) -> String? {
        guard let parts = URLComponents(string: raw), let host = parts.host?.lowercased() else { return nil }
        let authorize = host.hasSuffix(".supabase.co") && (parts.path).contains("/auth/v1/authorize")
        let google = host == "accounts.google.com"
        if !authorize && !google { return nil }
        if !authorize { return parts.string }
        var next = parts
        var items = next.queryItems ?? []
        items.removeAll { $0.name == "redirect_to" }
        items.append(URLQueryItem(name: "redirect_to", value: "co.shuknadlan.app://auth-callback"))
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

    static func authReturn(_ callback: String, returnTo: String?) -> String? {
        guard let cb = URLComponents(string: callback) else { return nil }
        if cb.scheme == "https", cb.host == siteHost { return cb.string }
        if cb.scheme != "co.shuknadlan.app" { return nil }
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

@objc(ShukShellPlugin)
public class ShukShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShukShellPlugin"
    public let jsName = "ShukShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeOAuthReturn", returnType: CAPPluginReturnPromise)
    ]

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("bad_url")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("open_failed") }
            }
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
        if ShellUrls.isExternal(raw) {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return true
        }
        return false
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
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "co.shuknadlan.app") { [weak webView] callback, _ in
            guard let callback = callback, let webView = webView else { return }
            let back = UserDefaults.standard.string(forKey: "shuk_oauth_return")
            guard let dest = ShellUrls.authReturn(callback.absoluteString, returnTo: back),
                  let destURL = URL(string: dest) else { return }
            DispatchQueue.main.async {
                webView.load(URLRequest(url: destURL))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authSession = session
        session.start()
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
