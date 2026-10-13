/* Test-only trusted input on the private compositor; never the user's seat. */
#include <wayland-client.h>
#include <linux/input-event-codes.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "virtual-pointer.h"
static struct zwlr_virtual_pointer_manager_v1 *manager;
static struct wl_seat *seat;
static void global(void *data,struct wl_registry *r,uint32_t name,const char *iface,uint32_t version){
 if(!strcmp(iface,"zwlr_virtual_pointer_manager_v1"))manager=wl_registry_bind(r,name,&zwlr_virtual_pointer_manager_v1_interface,1);
 if(!strcmp(iface,"wl_seat"))seat=wl_registry_bind(r,name,&wl_seat_interface,1);
}
static void removed(void *d,struct wl_registry *r,uint32_t n){}
static const struct wl_registry_listener listener={global,removed};
int main(int argc,char **argv){
 const char *display=getenv("WAYLAND_DISPLAY"),*proof=getenv("OMEGA_PROBE_DISPLAY");
 if(argc!=5||!display||!proof||strcmp(display,proof))return 2;
 struct wl_display *d=wl_display_connect(NULL);if(!d)return 3;
 struct wl_registry *r=wl_display_get_registry(d);wl_registry_add_listener(r,&listener,NULL);wl_display_roundtrip(d);
 if(!manager||!seat)return 4;
 struct zwlr_virtual_pointer_v1 *p=zwlr_virtual_pointer_manager_v1_create_virtual_pointer(manager,seat);
 wl_display_roundtrip(d);
 struct timespec wait={0,100000000};nanosleep(&wait,NULL);
 zwlr_virtual_pointer_v1_motion_absolute(p,1,atoi(argv[1]),atoi(argv[2]),atoi(argv[3]),atoi(argv[4]));
 zwlr_virtual_pointer_v1_frame(p);wl_display_roundtrip(d);nanosleep(&wait,NULL);
 zwlr_virtual_pointer_v1_button(p,2,BTN_LEFT,WL_POINTER_BUTTON_STATE_PRESSED);zwlr_virtual_pointer_v1_frame(p);wl_display_roundtrip(d);nanosleep(&wait,NULL);
 zwlr_virtual_pointer_v1_button(p,3,BTN_LEFT,WL_POINTER_BUTTON_STATE_RELEASED);zwlr_virtual_pointer_v1_frame(p);wl_display_roundtrip(d);nanosleep(&wait,NULL);
 zwlr_virtual_pointer_v1_destroy(p);wl_display_flush(d);wl_display_disconnect(d);return 0;
}
