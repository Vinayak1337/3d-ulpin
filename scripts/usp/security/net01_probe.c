/* NET-01 non-sensitive AppContainer token/socket probe. */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>

typedef struct {
    DWORD is_container, capability_count;
    char sid[256];
} TOKEN_SNAPSHOT;

static int token_report(HANDLE process, const char *role, TOKEN_SNAPSHOT *snapshot) {
    HANDLE token = NULL;
    DWORD needed = 0, error = 0;
    TOKEN_GROUPS *caps = NULL;
    TOKEN_APPCONTAINER_INFORMATION *package = NULL;
    LPSTR sid = NULL;
    int ok = 0;
    memset(snapshot, 0, sizeof(*snapshot));
    if (!OpenProcessToken(process, TOKEN_QUERY, &token)) goto done;
    if (!GetTokenInformation(token, TokenIsAppContainer, &snapshot->is_container,
                             sizeof(snapshot->is_container), &needed)) goto done;
    needed = 0;
    GetTokenInformation(token, TokenCapabilities, NULL, 0, &needed);
    if (!needed) goto done;
    caps = (TOKEN_GROUPS *)HeapAlloc(GetProcessHeap(), 0, needed);
    if (!caps || !GetTokenInformation(token, TokenCapabilities, caps, needed, &needed)) goto done;
    snapshot->capability_count = caps->GroupCount;
    needed = 0;
    GetTokenInformation(token, TokenAppContainerSid, NULL, 0, &needed);
    if (!needed) goto done;
    package = (TOKEN_APPCONTAINER_INFORMATION *)HeapAlloc(GetProcessHeap(), 0, needed);
    if (!package || !GetTokenInformation(token, TokenAppContainerSid, package, needed, &needed)) goto done;
    if (!ConvertSidToStringSidA(package->TokenAppContainer, &sid)) goto done;
    snprintf(snapshot->sid, sizeof(snapshot->sid), "%s", sid);
    ok = 1;
done:
    if (!ok) error = GetLastError();
    if (sid) LocalFree(sid);
    if (package) HeapFree(GetProcessHeap(), 0, package);
    if (caps) HeapFree(GetProcessHeap(), 0, caps);
    if (token) CloseHandle(token);
    if (ok) {
        printf("{\"kind\":\"token\",\"role\":\"%s\",\"isAppContainer\":%s,"
               "\"capabilityCount\":%lu,\"appContainerSid\":\"%s\"}\n",
               role, snapshot->is_container ? "true" : "false", snapshot->capability_count, snapshot->sid);
    } else {
        printf("{\"kind\":\"tokenError\",\"role\":\"%s\",\"error\":%lu}\n", role, error);
    }
    fflush(stdout);
    return ok;
}

static void socket_probe(int type, const char *ip, unsigned short port) {
    SOCKET s = socket(AF_INET, type, type == SOCK_STREAM ? IPPROTO_TCP : IPPROTO_UDP);
    if (s == INVALID_SOCKET) { printf("socket_error=%d\n", WSAGetLastError()); return; }
    DWORD timeout = 1000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeout, sizeof(timeout));
    struct sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, ip, &addr.sin_addr);
    int rc;
    if (type == SOCK_STREAM) {
        u_long nonblocking = 1;
        ioctlsocket(s, FIONBIO, &nonblocking);
        rc = connect(s, (const struct sockaddr *)&addr, sizeof(addr));
        int error = rc == SOCKET_ERROR ? WSAGetLastError() : 0;
        if (error == WSAEWOULDBLOCK) {
            fd_set writes; FD_ZERO(&writes); FD_SET(s, &writes);
            struct timeval limit = {1, 0};
            int ready = select(0, NULL, &writes, NULL, &limit);
            if (ready > 0) {
                int length = sizeof(error);
                getsockopt(s, SOL_SOCKET, SO_ERROR, (char *)&error, &length);
                rc = error ? SOCKET_ERROR : 0;
            } else { rc = SOCKET_ERROR; error = ready == 0 ? WSAETIMEDOUT : WSAGetLastError(); }
        }
        printf("tcp_connect_rc=%d error=%d\n", rc, error);
        if (rc == 0) {
            rc = send(s, "net01", 5, 0);
            printf("tcp_send_rc=%d error=%d\n", rc, rc == SOCKET_ERROR ? WSAGetLastError() : 0);
        }
    } else {
        rc = sendto(s, "net01", 5, 0, (const struct sockaddr *)&addr, sizeof(addr));
        printf("udp_send_rc=%d error=%d\n", rc, rc == SOCKET_ERROR ? WSAGetLastError() : 0);
    }
    closesocket(s);
}

int main(int argc, char **argv) {
    if (argc >= 3 && strcmp(argv[1], "handle") == 0) {
        HANDLE sentinel = (HANDLE)(uintptr_t)strtoull(argv[2], NULL, 10);
        char bytes[64] = {0}; DWORD count = 0;
        int ok = ReadFile(sentinel, bytes, sizeof(bytes)-1, &count, NULL);
        DWORD error = ok ? 0 : GetLastError();
        printf("{\"kind\":\"handleSentinel\",\"readSucceeded\":%s,\"error\":%lu,\"markerPresent\":%s}\n",
               ok ? "true" : "false", error,
               ok && strcmp(bytes, "NET01_LOCAL_HANDLE_SENTINEL") == 0 ? "true" : "false");
        return 0;
    }
    TOKEN_SNAPSHOT parent;
    const char *role = argc > 1 && strcmp(argv[1], "token") == 0 ? "descendant" : "parent";
    if (!token_report(GetCurrentProcess(), role, &parent)) return 2;
    if (argc < 2) return 0;
    if (strcmp(argv[1], "child") == 0) {
        STARTUPINFOEXA si = {0}; PROCESS_INFORMATION pi = {0};
        SIZE_T size = 0; LPPROC_THREAD_ATTRIBUTE_LIST attrs = NULL;
        int created = 0, validated = 0, resumed = 0, attrs_initialized = 0; DWORD code = 255;
        HANDLE handles[2] = {GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE)};
        char path[MAX_PATH], command[MAX_PATH + 32];
        DWORD path_length = GetModuleFileNameA(NULL, path, sizeof(path));
        if (!path_length || path_length >= sizeof(path)) goto child_done;
        InitializeProcThreadAttributeList(NULL, 1, 0, &size);
        attrs = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(GetProcessHeap(), 0, size);
        if (!attrs || !InitializeProcThreadAttributeList(attrs, 1, 0, &size)) goto child_done;
        attrs_initialized = 1;
        if (!UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                        handles, sizeof(handles), NULL, NULL)) goto child_done;
        si.StartupInfo.cb = sizeof(si); si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = handles[0]; si.StartupInfo.hStdOutput = handles[1];
        si.StartupInfo.hStdError = handles[1]; si.lpAttributeList = attrs;
        snprintf(command, sizeof(command), "\"%s\" token", path);
        created = CreateProcessA(path, command, NULL, NULL, TRUE,
                                 EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, NULL, NULL,
                                 &si.StartupInfo, &pi);
        if (!created) goto child_done;
        TOKEN_SNAPSHOT child;
        validated = token_report(pi.hProcess, "descendantBeforeResume", &child) &&
                    parent.is_container == 1 && parent.capability_count == 0 &&
                    child.is_container == 1 && child.capability_count == 0 && strcmp(parent.sid, child.sid) == 0;
        if (!validated) goto child_done;
        resumed = ResumeThread(pi.hThread) == 1;
        if (!resumed || WaitForSingleObject(pi.hProcess, 3000) != WAIT_OBJECT_0) goto child_done;
        if (!GetExitCodeProcess(pi.hProcess, &code)) code = 255;
child_done:
        if (created) {
            if (WaitForSingleObject(pi.hProcess, 0) != WAIT_OBJECT_0) {
                if (!TerminateProcess(pi.hProcess, 1) || WaitForSingleObject(pi.hProcess, 3000) != WAIT_OBJECT_0)
                    code = 255;
            }
            CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
        }
        if (attrs_initialized) DeleteProcThreadAttributeList(attrs);
        if (attrs) HeapFree(GetProcessHeap(), 0, attrs);
        printf("{\"kind\":\"childResult\",\"created\":%s,\"preResumeValidated\":%s,\"resumeSucceeded\":%s,\"exitCode\":%lu}\n",
               created ? "true" : "false", validated ? "true" : "false", resumed ? "true" : "false", code);
        return created && validated && resumed && code == 0 ? 0 : 3;
    } else if (argc >= 4 && strcmp(argv[1], "tcp") == 0) {
        WSADATA data; WSAStartup(MAKEWORD(2, 2), &data);
        socket_probe(SOCK_STREAM, argv[2], (unsigned short)atoi(argv[3])); WSACleanup();
    } else if (argc >= 4 && strcmp(argv[1], "udp") == 0) {
        WSADATA data; WSAStartup(MAKEWORD(2, 2), &data);
        socket_probe(SOCK_DGRAM, argv[2], (unsigned short)atoi(argv[3])); WSACleanup();
    } else if (argc >= 3 && strcmp(argv[1], "dns") == 0) {
        WSADATA data; WSAStartup(MAKEWORD(2, 2), &data);
        struct addrinfo *answer = NULL;
        int rc = getaddrinfo(argv[2], "9", NULL, &answer);
        printf("dns_rc=%d\n", rc);
        if (answer) freeaddrinfo(answer);
        WSACleanup();
    }
    return 0;
}
