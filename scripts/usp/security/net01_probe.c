/* NET-01 non-sensitive AppContainer token/socket probe. */
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <sddl.h>
#include <stdio.h>
#include <string.h>

static void token_report(void) {
    HANDLE token = NULL;
    DWORD needed = 0, is_container = 0;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        printf("token_open_error=%lu\n", GetLastError()); return;
    }
    if (!GetTokenInformation(token, TokenIsAppContainer, &is_container, sizeof(is_container), &needed))
        printf("token_container_error=%lu\n", GetLastError());
    else printf("is_appcontainer=%lu\n", is_container);
    GetTokenInformation(token, TokenCapabilities, NULL, 0, &needed);
    if (needed) {
        TOKEN_GROUPS *caps = (TOKEN_GROUPS *)HeapAlloc(GetProcessHeap(), 0, needed);
        if (caps && GetTokenInformation(token, TokenCapabilities, caps, needed, &needed))
            printf("capability_count=%lu\n", caps->GroupCount);
        else printf("capability_error=%lu\n", GetLastError());
        if (caps) HeapFree(GetProcessHeap(), 0, caps);
    }
    GetTokenInformation(token, TokenAppContainerSid, NULL, 0, &needed);
    if (needed) {
        TOKEN_APPCONTAINER_INFORMATION *package = (TOKEN_APPCONTAINER_INFORMATION *)HeapAlloc(GetProcessHeap(), 0, needed);
        if (package && GetTokenInformation(token, TokenAppContainerSid, package, needed, &needed)) {
            LPSTR sid = NULL;
            if (ConvertSidToStringSidA(package->TokenAppContainer, &sid)) {
                printf("appcontainer_sid=%s\n", sid); LocalFree(sid);
            }
        }
        if (package) HeapFree(GetProcessHeap(), 0, package);
    }
    CloseHandle(token);
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
    SetStdHandle(STD_OUTPUT_HANDLE, GetStdHandle(STD_OUTPUT_HANDLE));
    token_report();
    if (argc < 2) return 0;
    if (strcmp(argv[1], "child") == 0) {
        STARTUPINFOA si = {0}; PROCESS_INFORMATION pi = {0};
        si.cb = sizeof(si); si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
        si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
        char command[MAX_PATH + 32];
        snprintf(command, sizeof(command), "\"%s\" token", argv[0]);
        int ok = CreateProcessA(argv[0], command, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi);
        printf("child_create=%d error=%lu\n", ok, ok ? 0 : GetLastError()); fflush(stdout);
        if (ok) {
            WaitForSingleObject(pi.hProcess, 3000);
            DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);
            printf("child_exit=%lu\n", code);
            CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
        }
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
