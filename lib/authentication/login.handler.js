import { INVALID_AUTH_CONFIG_ERROR, WrongArgumentError } from "../errors.js";
const getLoginPath = (admin) => {
    const { loginPath, rootPath } = admin.options;
    // since we are inside already namespaced router we have to replace login and logout routes that
    // they don't have rootUrl inside. So changing /admin/login to just /login.
    // but there is a case where user gives / as a root url and /login becomes `login`. We have to
    // fix it by adding / in front of the route
    const normalizedLoginPath = loginPath.replace(rootPath, "");
    return normalizedLoginPath.startsWith("/")
        ? normalizedLoginPath
        : `/${normalizedLoginPath}`;
};
class Retry {
    constructor(ip) {
        this.retriesCount = 0;
        const existing = Retry.retriesContainer.get(ip);
        if (existing) {
            return existing;
        }
        Retry.retriesContainer.set(ip, this);
    }
    canLogin(maxRetries) {
        if (maxRetries === undefined) {
            return true;
        }
        else if (typeof maxRetries === "number") {
            maxRetries = {
                count: maxRetries,
                duration: 60,
            };
        }
        else if (maxRetries.count <= 0) {
            return true;
        }
        if (!this.lastRetry ||
            new Date().getTime() - this.lastRetry.getTime() >
                maxRetries.duration * 1000) {
            this.lastRetry = new Date();
            this.retriesCount = 1;
            return true;
        }
        else {
            this.lastRetry = new Date();
            this.retriesCount++;
            return this.retriesCount <= maxRetries.count;
        }
    }
}
Retry.retriesContainer = new Map();
export const withLogin = (router, admin, auth) => {
    var _a, _b;
    const { rootPath } = admin.options;
    const loginPath = getLoginPath(admin);
    const { provider } = auth;
    const providerProps = (_b = (_a = provider === null || provider === void 0 ? void 0 : provider.getUiProps) === null || _a === void 0 ? void 0 : _a.call(provider)) !== null && _b !== void 0 ? _b : {};
    router.get(loginPath, async (req, res) => {
        const baseProps = {
            action: admin.options.loginPath,
            errorMessage: null,
        };
        const login = await admin.renderLogin(Object.assign(Object.assign({}, baseProps), providerProps));
        return res.send(login);
    });
    router.post(loginPath, async (req, res, next) => {
        var _a;
        if (!new Retry(req.ip).canLogin(auth.maxRetries)) {
            const login = await admin.renderLogin(Object.assign({ action: admin.options.loginPath, errorMessage: "tooManyRequests" }, providerProps));
            return res.send(login);
        }
        const context = { req, res };
        let adminUser;
        try {
            if (provider) {
                adminUser = await provider.handleLogin({
                    headers: req.headers,
                    query: req.query,
                    params: req.params,
                    data: (_a = req.fields) !== null && _a !== void 0 ? _a : {},
                }, context);
            }
            else if (auth.authenticate) {
                const { email, password } = req.fields;
                // "auth.authenticate" must always be defined if "auth.provider" isn't
                adminUser = await auth.authenticate(email, password, context);
            }
            else {
                throw new WrongArgumentError(INVALID_AUTH_CONFIG_ERROR);
            }
        }
        catch (error) {
            const errorMessage = error.message || error.error || "invalidCredentials";
            const loginPage = await admin.renderLogin(Object.assign({ action: admin.options.loginPath, errorMessage }, providerProps));
            return res.status(400).send(loginPage);
        }
        if (adminUser) {
            req.session.adminUser = adminUser;
            req.session.save((err) => {
                if (err) {
                    return next(err);
                }
                if (req.session.redirectTo) {
                    return res.redirect(302, req.session.redirectTo);
                }
                else {
                    return res.redirect(302, rootPath);
                }
            });
        }
        else {
            const login = await admin.renderLogin(Object.assign({ action: admin.options.loginPath, errorMessage: "invalidCredentials" }, providerProps));
            return res.send(login);
        }
    });
};
