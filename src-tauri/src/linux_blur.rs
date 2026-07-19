use gtk::{glib::translate::ToGlibPtr, prelude::*};
use std::{cell::RefCell, rc::Rc};
use tauri::Runtime;
use wayland_client::{
    backend::{Backend, ObjectId},
    delegate_noop,
    globals::{registry_queue_init, GlobalList, GlobalListContents},
    protocol::{wl_registry, wl_surface::WlSurface},
    Connection, Dispatch, EventQueue, Proxy, QueueHandle,
};
use wayland_protocols::ext::background_effect::v1::client::{
    ext_background_effect_manager_v1::ExtBackgroundEffectManagerV1,
    ext_background_effect_surface_v1::ExtBackgroundEffectSurfaceV1,
};
use wayland_protocols_plasma::blur::client::{
    org_kde_kwin_blur::OrgKdeKwinBlur,
    org_kde_kwin_blur_manager::OrgKdeKwinBlurManager,
};

const STANDARD_BLUR_INTERFACE: &str = "ext_background_effect_manager_v1";
const KDE_BLUR_INTERFACE: &str = "org_kde_kwin_blur_manager";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlurProtocol {
    Standard,
    Kde,
}

fn select_blur_protocol<'a>(interfaces: impl IntoIterator<Item = &'a str>) -> Option<BlurProtocol> {
    let mut standard = false;
    let mut kde = false;

    for interface in interfaces {
        standard |= interface == STANDARD_BLUR_INTERFACE;
        kde |= interface == KDE_BLUR_INTERFACE;
    }

    standard
        .then_some(BlurProtocol::Standard)
        .or_else(|| kde.then_some(BlurProtocol::Kde))
}

#[derive(Default)]
struct BlurState;

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for BlurState {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

delegate_noop!(BlurState: ignore ExtBackgroundEffectManagerV1);
delegate_noop!(BlurState: ignore ExtBackgroundEffectSurfaceV1);
delegate_noop!(BlurState: ignore OrgKdeKwinBlurManager);
delegate_noop!(BlurState: ignore OrgKdeKwinBlur);

enum BlurObjects {
    Standard {
        _manager: ExtBackgroundEffectManagerV1,
        _effect: ExtBackgroundEffectSurfaceV1,
    },
    Kde {
        _manager: OrgKdeKwinBlurManager,
        _effect: OrgKdeKwinBlur,
    },
}

struct BlurSession {
    protocol: BlurProtocol,
    _connection: Connection,
    _globals: GlobalList,
    _event_queue: EventQueue<BlurState>,
    _objects: BlurObjects,
}

thread_local! {
    static BLUR_SESSION: RefCell<Option<BlurSession>> = const { RefCell::new(None) };
}

pub fn install<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let gtk_window = window
        .gtk_window()
        .map_err(|error| format!("GTK window is unavailable: {error}"))?;
    let initialized = Rc::new(std::cell::Cell::new(false));
    let mapped_initialized = Rc::clone(&initialized);

    gtk_window.connect_map(move |window| {
        initialize_once(window, &mapped_initialized);
    });

    if gtk_window.is_mapped() {
        initialize_once(&gtk_window, &initialized);
    }

    Ok(())
}

fn initialize_once(window: &gtk::ApplicationWindow, initialized: &std::cell::Cell<bool>) {
    if initialized.replace(true) {
        return;
    }

    match create_blur_session(window) {
        Ok(Some(session)) => {
            eprintln!(
                "[quick-chat] Linux Wayland background blur enabled via {:?}",
                session.protocol
            );
            BLUR_SESSION.with(|slot| {
                slot.replace(Some(session));
            });
        }
        Ok(None) => {
            eprintln!(
                "[quick-chat] Wayland compositor has no supported blur protocol; using CSS fallback"
            );
        }
        Err(error) => {
            eprintln!("[quick-chat] Wayland blur unavailable ({error}); using CSS fallback");
        }
    }
}

fn create_blur_session(window: &gtk::ApplicationWindow) -> Result<Option<BlurSession>, String> {
    let gdk_window = window
        .window()
        .ok_or_else(|| "GTK window has not created a GDK surface".to_string())?;
    let display = gdk_window.display();

    let display_ptr: *mut gtk::gdk::ffi::GdkDisplay = display.to_glib_none().0;
    let window_ptr: *mut gtk::gdk::ffi::GdkWindow = gdk_window.to_glib_none().0;

    let is_wayland = unsafe {
        gtk::glib::gobject_ffi::g_type_check_instance_is_a(
            display_ptr.cast(),
            gdk_wayland_sys::gdk_wayland_display_get_type(),
        ) != 0
            && gtk::glib::gobject_ffi::g_type_check_instance_is_a(
                window_ptr.cast(),
                gdk_wayland_sys::gdk_wayland_window_get_type(),
            ) != 0
    };
    if !is_wayland {
        return Ok(None);
    }

    let wayland_display: *mut std::ffi::c_void = unsafe {
        gdk_wayland_sys::gdk_wayland_display_get_wl_display(display_ptr.cast())
    };
    let wayland_surface: *mut std::ffi::c_void = unsafe {
        gdk_wayland_sys::gdk_wayland_window_get_wl_surface(window_ptr.cast())
    };
    if wayland_display.is_null() || wayland_surface.is_null() {
        return Err("GDK did not expose its Wayland display or surface".to_string());
    }

    let backend = unsafe { Backend::from_foreign_display(wayland_display.cast()) };
    let connection = Connection::from_backend(backend);
    let surface_id = unsafe { ObjectId::from_ptr(WlSurface::interface(), wayland_surface.cast()) }
        .map_err(|_| "GDK returned an invalid wl_surface".to_string())?;
    let surface = WlSurface::from_id(&connection, surface_id)
        .map_err(|_| "failed to import GDK's wl_surface".to_string())?;
    let (globals, event_queue) = registry_queue_init::<BlurState>(&connection)
        .map_err(|error| format!("failed to read Wayland globals: {error}"))?;
    let protocol = globals.contents().with_list(|list| {
        select_blur_protocol(list.iter().map(|global| global.interface.as_str()))
    });
    let Some(protocol) = protocol else {
        return Ok(None);
    };
    let queue_handle = event_queue.handle();

    let objects = match protocol {
        BlurProtocol::Standard => {
            let manager: ExtBackgroundEffectManagerV1 = globals
                .bind(&queue_handle, 1..=1, ())
                .map_err(|error| format!("failed to bind standard blur protocol: {error}"))?;
            let effect = manager.get_background_effect(&surface, &queue_handle, ());
            effect.set_blur_region(None);
            surface.commit();
            BlurObjects::Standard {
                _manager: manager,
                _effect: effect,
            }
        }
        BlurProtocol::Kde => {
            let manager: OrgKdeKwinBlurManager = globals
                .bind(&queue_handle, 1..=1, ())
                .map_err(|error| format!("failed to bind KDE blur protocol: {error}"))?;
            let effect = manager.create(&surface, &queue_handle, ());
            effect.set_region(None);
            effect.commit();
            BlurObjects::Kde {
                _manager: manager,
                _effect: effect,
            }
        }
    };

    connection
        .flush()
        .map_err(|error| format!("failed to flush Wayland blur request: {error}"))?;

    Ok(Some(BlurSession {
        protocol,
        _connection: connection,
        _globals: globals,
        _event_queue: event_queue,
        _objects: objects,
    }))
}

#[cfg(test)]
mod tests {
    use super::{select_blur_protocol, BlurProtocol};

    #[test]
    fn standard_background_effect_is_preferred() {
        let protocol = select_blur_protocol([
            "org_kde_kwin_blur_manager",
            "ext_background_effect_manager_v1",
        ]);

        assert_eq!(protocol, Some(BlurProtocol::Standard));
    }

    #[test]
    fn kde_blur_is_used_as_the_legacy_fallback() {
        let protocol = select_blur_protocol(["org_kde_kwin_blur_manager"]);

        assert_eq!(protocol, Some(BlurProtocol::Kde));
    }

    #[test]
    fn missing_blur_protocol_is_non_fatal() {
        let protocol = select_blur_protocol(["wl_compositor", "xdg_wm_base"]);

        assert_eq!(protocol, None);
    }
}
